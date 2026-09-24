import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { encodeCsv, importReview, makePlan, parseCsv, readReview, rollbackRows, type RacketRow, type ReviewRow } from "./racket-release-years";

const row: ReviewRow = {
  brand: "Yonex", name: "Arcsaber 11 Pro", slug: "yonex-arcsaber-11-pro",
  release_year: "2022", id: "r-arc11", brand_id: "b-yonex", original_release_year: "2026",
  status: "verified", source_url: "https://www.yonex.com/news/example/", notes: "Manufacturer launch: February 2022.",
};
const live: RacketRow = { id: row.id, brand_id: row.brand_id, brand: row.brand, name: row.name, slug: row.slug, release_year: 2026 };

test("CSV preserves Vietnamese, commas, quotes, multiline evidence, BOM and reordered columns", () => {
  const sample = { ...row, name: 'Vợt "Đỏ", bản mới', notes: 'Release announcement\nManufacturer says "2022".' };
  assert.deepEqual(readReview("\uFEFF" + encodeCsv([sample])), [sample]);
  const cells = parseCsv(encodeCsv([row]));
  assert.deepEqual(readReview(cells.map(record => record.reverse().join(",")).join("\n")), [row]);
});

test("malformed or duplicated records are rejected before database access", () => {
  for (const csv of ['a,"unclosed', 'a,"closed"junk', 'a,b"bad', 'a,b\rc']) assert.throws(() => parseCsv(csv));
  assert.throws(() => readReview(encodeCsv([row, row])), /duplicate/);
  assert.throws(() => readReview(encodeCsv([row]) + "missing,columns\n"), /column count/);
  assert.throws(() => readReview(encodeCsv([row]).replace("brand,name", "brand,brand")), /columns/);
});

test("only documented verified corrections can change a year", () => {
  for (const release_year of ["", "2022.5", "NaN", "1899", "9999", "2022 OR 1=1"]) {
    assert.throws(() => readReview(encodeCsv([{ ...row, release_year }])), /year/);
  }
  for (const status of ["unreviewed", "unresolved"]) assert.throws(() => readReview(encodeCsv([{ ...row, status }])), /only verified/);
  for (const source_url of ["", "not-a-url", "file:///local"]) assert.throws(() => readReview(encodeCsv([{ ...row, source_url }])), /source URL/);
  assert.throws(() => readReview(encodeCsv([{ ...row, notes: "" }])), /evidence/);
});

test("an unnamed database record can be exported and left unresolved, but never verified", () => {
  const unnamed = { ...row, name: "", status: "unresolved", release_year: "2026", source_url: "", notes: "Missing model name" };
  assert.deepEqual(readReview(encodeCsv([unnamed])), [unnamed]);
  assert.throws(() => readReview(encodeCsv([{ ...row, name: "" }])), /no model name/);
});

test("plan refuses stale values, missing rows, or renamed/reassigned identities", () => {
  assert.throws(() => makePlan([row], []), /no longer exists/);
  assert.throws(() => makePlan([row], [{ ...live, release_year: 2020 }]), /stale year/);
  for (const key of ["slug", "name", "brand_id", "brand"] as const) {
    assert.throws(() => makePlan([row], [{ ...live, [key]: "different" }]), /identity changed/);
  }
});

test("reruns are idempotent and unresolved rows remain untouched", () => {
  const unresolved = { ...row, id: "unknown", slug: "unknown", status: "unresolved", release_year: "2026", source_url: "" };
  assert.deepEqual(makePlan([row, unresolved], [{ ...live, release_year: 2022 }]), { changes: [], alreadyCorrect: 1 });
});

test("rollback CSV reverses exactly the applied years", () => {
  const { changes } = makePlan([row], [live]);
  const rollback = readReview(encodeCsv(rollbackRows(changes)));
  const reverse = makePlan(rollback, [{ ...live, release_year: 2022 }]);
  assert.equal(reverse.changes[0].before, 2022);
  assert.equal(reverse.changes[0].after, 2026);
});

function database(options: { changedCount?: number; failUpdate?: boolean; failSelect?: boolean } = {}) {
  const queries: string[] = [];
  const client = { async query(sql: string, params?: unknown[]) {
    queries.push(sql);
    if (sql.includes("select r.id")) {
      if (options.failSelect) throw new Error("connection lost");
      return { rows: [live], rowCount: 1 };
    }
    if (sql.includes("update public.rackets")) {
      assert.deepEqual(JSON.parse(String(params?.[0])), [{ id: row.id, before: 2026, after: 2022 }]);
      if (options.failUpdate) throw new Error("constraint rejected");
      return { rows: [{ id: row.id, release_year: 2022 }], rowCount: options.changedCount ?? 1 };
    }
    return { rows: [], rowCount: null };
  } } as unknown as Pick<pg.Client, "query">;
  return { client, queries };
}

test("preview is read-only and never creates backup or issues update", async () => {
  const { client, queries } = database();
  const result = await importReview(client, [row], false, () => assert.fail("preview wrote backup"));
  assert.equal(result.changes.length, 1);
  assert.equal(queries[0], "BEGIN READ ONLY");
  assert.equal(queries.at(-1), "COMMIT");
  assert.ok(!queries.some(sql => /update|for update/i.test(sql)));
});

test("apply locks rows and writes backup before any update", async () => {
  const { client, queries } = database();
  await importReview(client, [row], true, changes => {
    assert.equal(changes.length, 1);
    assert.ok(queries.at(-1)?.includes("for update of r, b"));
    assert.ok(!queries.some(sql => sql.includes("update public.rackets")));
  });
  assert.equal(queries.at(-1), "COMMIT");
});

test("backup, SQL, and verification failures roll back the entire batch", async () => {
  for (const options of [{ failUpdate: true }, { changedCount: 0 }, { failSelect: true }]) {
    const { client, queries } = database(options);
    await assert.rejects(importReview(client, [row], true, () => {}));
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.ok(!queries.includes("COMMIT"));
  }
  const { client, queries } = database();
  await assert.rejects(importReview(client, [row], true, () => { throw new Error("disk full"); }), /disk full/);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.some(sql => sql.includes("update public.rackets")));
});
