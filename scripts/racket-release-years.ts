/** File-based release-year review. No LLM provider, API key, or AI API calls. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadEnv } from "./scraper/env";

export const COLUMNS = [
  "brand", "name", "slug", "release_year", "id", "brand_id",
  "original_release_year", "status", "source_url", "notes",
] as const;
export type ReviewRow = Record<(typeof COLUMNS)[number], string>;
export interface RacketRow {
  id: string;
  brand_id: string;
  brand: string;
  name: string;
  slug: string;
  release_year: number;
}
export interface Change {
  review: ReviewRow;
  before: number;
  after: number;
}

const DEFAULT_FILE = "data/racket-release-years.csv";
const SELECT = `select r.id, r.brand_id, b.name as brand, r.name, r.slug, r.release_year
  from public.rackets r join public.brands b on b.id = r.brand_id`;

/** Strict RFC 4180-style parser, including Excel's UTF-8 BOM and quoted newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === "," || char === "\n") {
      row.push(value); value = ""; closed = false;
      if (char === "\n") { rows.push(row); row = []; }
    } else if (char === '"' && !value && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"' || char === "\r") throw new Error(`Malformed CSV at character ${i + 1}`);
      value += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (value || closed || row.length) { row.push(value); rows.push(row); }
  return rows;
}

export function encodeCsv(rows: ReviewRow[]): string {
  const quote = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [COLUMNS.join(","), ...rows.map(row => COLUMNS.map(key => quote(row[key])).join(","))].join("\r\n") + "\r\n";
}

function year(value: string, label: string): number {
  if (!/^\d{4}$/.test(value) || Number(value) < 1900 || Number(value) > new Date().getFullYear()) {
    throw new Error(`${label}: expected a four-digit year between 1900 and the current year`);
  }
  return Number(value);
}

export function readReview(csv: string): ReviewRow[] {
  const [header, ...records] = parseCsv(csv);
  if (!header || header.length !== COLUMNS.length || new Set(header).size !== header.length || COLUMNS.some(key => !header.includes(key))) {
    throw new Error(`CSV must contain exactly these columns: ${COLUMNS.join(",")}`);
  }
  const ids = new Set<string>(), slugs = new Set<string>();
  return records.map((record, index) => {
    const label = `CSV row ${index + 2}`;
    if (record.length !== header.length) throw new Error(`${label}: wrong column count`);
    const row = Object.fromEntries(header.map((key, i) => [key, record[i]])) as ReviewRow;
    for (const key of ["brand", "slug", "id", "brand_id"] as const) {
      if (!row[key].trim()) throw new Error(`${label}: missing ${key}`);
    }
    if (ids.has(row.id) || slugs.has(row.slug)) throw new Error(`${label}: duplicate id or slug`);
    ids.add(row.id); slugs.add(row.slug);
    const original = year(row.original_release_year, `${label} original_release_year`);
    const corrected = year(row.release_year, `${label} release_year`);
    if (!["unreviewed", "verified", "unresolved"].includes(row.status)) throw new Error(`${label}: invalid status`);
    if (row.status === "verified") {
      if (!row.name.trim()) throw new Error(`${label}: cannot verify a racket with no model name`);
      const urls = row.source_url.split(" | ");
      for (const source of urls) {
        let url: URL;
        try { url = new URL(source); } catch { throw new Error(`${label}: verified rows need a source URL`); }
        if (!["https:", "http:"].includes(url.protocol)) throw new Error(`${label}: source URL must use HTTP(S)`);
      }
      if (!row.notes.trim()) throw new Error(`${label}: verified rows need evidence notes`);
    } else if (corrected !== original) {
      throw new Error(`${label}: only verified rows may change release_year`);
    }
    return row;
  });
}

export function makePlan(review: ReviewRow[], current: RacketRow[]): { changes: Change[]; alreadyCorrect: number } {
  const byId = new Map(current.map(row => [row.id, row]));
  const changes: Change[] = [];
  let alreadyCorrect = 0;
  for (const row of review.filter(row => row.status === "verified")) {
    const live = byId.get(row.id);
    if (!live) throw new Error(`${row.slug}: racket no longer exists`);
    if (live.slug !== row.slug || live.brand_id !== row.brand_id || live.name !== row.name || live.brand !== row.brand) {
      throw new Error(`${row.slug}: identity changed since export; export/review again`);
    }
    const before = Number(row.original_release_year), after = Number(row.release_year);
    if (live.release_year === after) { alreadyCorrect++; continue; }
    if (live.release_year !== before) throw new Error(`${row.slug}: stale year (CSV ${before}, database ${live.release_year})`);
    changes.push({ review: row, before, after });
  }
  return { changes, alreadyCorrect };
}

export function rollbackRows(changes: Change[]): ReviewRow[] {
  return changes.map(({ review, before, after }) => ({
    ...review,
    original_release_year: String(after), release_year: String(before),
    notes: `Rollback to pre-import value ${before}; original research: ${review.notes}`,
  }));
}

type Database = Pick<pg.Client, "query">;

/** Re-check under row locks, back up before writing, and commit every change together. */
export async function importReview(
  client: Database,
  review: ReviewRow[],
  apply: boolean,
  backup: (changes: Change[]) => void,
): Promise<{ changes: Change[]; alreadyCorrect: number }> {
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    const ids = review.filter(row => row.status === "verified").map(row => row.id);
    const { rows } = await client.query<RacketRow>(
      `${SELECT} where r.id = any($1::text[]) order by r.id${apply ? " for update of r, b" : ""}`, [ids],
    );
    const plan = makePlan(review, rows);
    if (apply && plan.changes.length) {
      backup(plan.changes);
      const payload = plan.changes.map(change => ({ id: change.review.id, before: change.before, after: change.after }));
      const result = await client.query<{ id: string; release_year: number }>(`
        update public.rackets r set release_year = patch.after
        from jsonb_to_recordset($1::jsonb) as patch(id text, before integer, after integer)
        where r.id = patch.id and r.release_year = patch.before
        returning r.id, r.release_year`, [JSON.stringify(payload)]);
      const expected = new Map(payload.map(row => [row.id, row.after]));
      if (result.rowCount !== plan.changes.length || result.rows.some(row => expected.get(row.id) !== row.release_year)) {
        throw new Error("Update verification failed; rolling back the entire import");
      }
    }
    await client.query("COMMIT");
    return plan;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...flags] = args;
  if (!command || command === "--help") {
    console.log(`Usage: npm run rackets:years -- <export|validate|import> [--file=path.csv] [--apply]
export    Export ALL live rackets; refuses to overwrite a file.
validate  Check the reviewed CSV offline, without database access.
import    Preview verified changes (read-only). --apply commits them together.
Default: ${DEFAULT_FILE}
Edit release_year, status, source_url, notes. Keep identity/original columns intact.
No AI API calls. See docs/racket-release-years.md for the file review prompt.`);
    return;
  }
  if (!["export", "validate", "import"].includes(command)) throw new Error(`Unknown command: ${command}`);
  let file = DEFAULT_FILE, apply = false, fileSeen = false;
  for (const flag of flags) {
    if (flag.startsWith("--file=") && flag.slice(7) && !fileSeen) { file = flag.slice(7); fileSeen = true; }
    else if (flag === "--apply" && !apply) apply = true;
    else throw new Error(`Unknown or duplicate option: ${flag}`);
  }
  if (apply && command !== "import") throw new Error("--apply is only valid for import");
  const path = resolve(file);
  const review = command === "export" ? [] : readReview(readFileSync(path, "utf8"));
  if (command !== "export") {
    const counts = Object.fromEntries(["verified", "unresolved", "unreviewed"].map(status => [status, review.filter(row => row.status === status).length]));
    console.log(JSON.stringify({ file: path, rows: review.length, ...counts }));
    if (command === "validate") return;
  }
  loadEnv();
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set SUPABASE_DB_URL, DIRECT_URL, or DATABASE_URL in .env.local (no AI credentials needed)");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
  try {
    await client.connect();
    if (command === "export") {
      // A single SQL snapshot has no PostgREST 1,000-row truncation or paging drift.
      const { rows } = await client.query<RacketRow>(`${SELECT} order by b.name, r.name, r.id`);
      const output: ReviewRow[] = rows.map(row => ({
        ...row, release_year: String(row.release_year), original_release_year: String(row.release_year),
        status: "unreviewed", source_url: "", notes: "",
      }));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, encodeCsv(output), { encoding: "utf8", flag: "wx" });
      console.log(`Exported ${rows.length} rackets to ${path}`);
      return;
    }
    let rollbackPath: string | undefined;
    const result = await importReview(client, review, apply, changes => {
      const directory = resolve("backups", "racket-release-years");
      mkdirSync(directory, { recursive: true });
      rollbackPath = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-rollback.csv`);
      writeFileSync(rollbackPath, encodeCsv(rollbackRows(changes)), { encoding: "utf8", flag: "wx" });
      console.log(`Rollback file: ${rollbackPath}`);
    });
    for (const { review: row, before, after } of result.changes) console.log(`${row.brand} / ${row.slug}: ${before} -> ${after}`);
    console.log(`${apply ? "Committed" : "Would update"} ${result.changes.length}; already correct ${result.alreadyCorrect}.`);
    if (!apply) console.log("No writes made. Add --apply to commit the verified changes.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
