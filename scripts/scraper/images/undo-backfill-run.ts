import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../env";
import { revalidateCatalogue } from "../revalidate";
import { TAG } from "../../../src/lib/data/tags";
import { RETAILERS, type Retailer } from "./retailers";

/**
 * Undo the gallery rows one backfill run inserted, so those rackets can be
 * imported again.
 *
 * This exists because a run's rows carry the identity of the remover that
 * produced them. Improve the remover and its fingerprint changes, so the
 * rackets it already filled are skipped rather than reprocessed — correct,
 * but it also means a run made with a detector that has since been fixed can
 * only be redone by clearing it first.
 *
 * `--site=` narrows that to the rackets a given retailer contributed to: a
 * target is only reprocessed when *every* row on it belongs to the new run,
 * so a racket that drew from the broken source has to lose its other rows
 * too. Rackets that never touched that source keep everything.
 *
 * Only rows this exact run created are touched — they share one id prefix —
 * and a hero pointer is restored to what the plan recorded before the run,
 * never to a guess. Storage objects are left in place: the re-import writes
 * the same bytes to the same checksum-derived path, and `images:reconcile`
 * reports anything that stays unreferenced.
 */
interface RunReport {
  planId: string;
  processingId: string;
  project: string;
  mode: string;
  results: { racketId: string; racketSlug: string; images: { site: Retailer }[] }[];
}
interface RunPlan {
  project: string;
  before: { id: string; hero_image_url: string | null; hero_thumb_url: string | null }[];
}

export function undoOptions(args: string[]) {
  const values: Record<string, string | boolean> = {};
  const known = new Set(["report", "plan", "site", "apply"]);
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match || !known.has(match[1])) throw new Error(`Unknown argument: ${arg}`);
    values[match[1]] = match[2] ?? true;
  }
  if (values.apply !== undefined && values.apply !== true) throw new Error("--apply does not take a value");
  for (const key of ["report", "plan"]) {
    if (typeof values[key] !== "string" || !values[key]) throw new Error(`--${key}=<file> is required`);
  }
  if (values.site !== undefined && !RETAILERS.includes(values.site as Retailer)) {
    throw new Error(`--site must be one of ${RETAILERS.join(", ")}`);
  }
  return {
    report: values.report as string,
    plan: values.plan as string,
    site: typeof values.site === "string" ? (values.site as Retailer) : null,
    apply: values.apply === true,
  };
}

/** Rackets whose rows must go for them to be importable again. */
export function targetsToClear(report: RunReport, site: Retailer | null): string[] {
  return report.results
    .filter((result) => result.images.length && (!site || result.images.some((image) => image.site === site)))
    .map((result) => result.racketId);
}

export async function undoBackfillRun(args = process.argv.slice(2)) {
  const options = undoOptions(args);
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const project = new URL(url).hostname;
  const report = JSON.parse(readFileSync(options.report, "utf8")) as RunReport;
  const plan = JSON.parse(readFileSync(options.plan, "utf8")) as RunPlan;
  if (report.project !== project || plan.project !== project) throw new Error("Report or plan belongs to another Supabase project");
  const prefix = `retail-${report.planId}-${report.processingId}-`;
  const targets = targetsToClear(report, options.site);
  const before = new Map(plan.before.map((row) => [row.id, row]));
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log(JSON.stringify({
    report: options.report, site: options.site ?? "all", prefix,
    racketsToClear: targets.length, mode: options.apply ? "apply" : "dry-run",
  }, null, 2));

  let deleted = 0, heroes = 0, failures = 0;
  for (const racketId of targets) {
    // Only this run's rows, never a staff upload or an earlier crawl.
    const { data: rows, error } = await db.from("racket_images")
      .select("id,public_url,thumb_url").eq("racket_id", racketId).like("id", `${prefix}%`);
    if (error) { failures++; console.error(`${racketId}: ${error.message}`); continue; }
    if (!rows?.length) continue;
    if (!options.apply) { deleted += rows.length; continue; }
    const { error: deleteError } = await db.from("racket_images")
      .delete().eq("racket_id", racketId).like("id", `${prefix}%`);
    if (deleteError) { failures++; console.error(`${racketId}: ${deleteError.message}`); continue; }
    deleted += rows.length;
    // Restore the hero pointer only where this run is what set it.
    const published = new Set(rows.map((row) => row.public_url).filter(Boolean));
    const previous = before.get(racketId);
    const { data: racket } = await db.from("rackets").select("hero_image_url").eq("id", racketId).maybeSingle();
    if (racket?.hero_image_url && published.has(racket.hero_image_url)) {
      const { error: heroError } = await db.from("rackets")
        .update({ hero_image_url: previous?.hero_image_url ?? null, hero_thumb_url: previous?.hero_thumb_url ?? null })
        .eq("id", racketId).eq("hero_image_url", racket.hero_image_url);
      if (heroError) { failures++; console.error(`${racketId} hero: ${heroError.message}`); continue; }
      heroes++;
    }
    if (deleted % 200 === 0) console.log(`  cleared ${deleted} rows`);
  }
  console.log(JSON.stringify({ rowsDeleted: deleted, heroPointersRestored: heroes, failures }, null, 2));
  if (options.apply && deleted) await revalidateCatalogue([TAG.rackets]);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  undoBackfillRun().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
