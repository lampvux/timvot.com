import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, read, readRoot } from "./source";
import { REVIEW_LIMITS } from "../review-standards";

/**
 * The review limits are written twice, and must agree.
 *
 * `submit_review` and `update_review` enforce them, because a direct RPC
 * call skips the form;
 * `review-standards.ts` repeats them so the form can name the rule a draft
 * broke. A limit changed on one side only either rejects a review the form
 * promised would pass or tells an author a rule the database does not hold.
 */

/** The body of the newest migration that defines `public.<name>`. */
function latestDefinition(name: string): { file: string; body: string } {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .reverse();
  const opener = new RegExp(`create (or replace )?function public\\.${name}\\(`);
  for (const file of files) {
    const sql = readRoot("supabase", "migrations", file);
    const start = sql.search(opener);
    if (start < 0) continue;
    // Up to the end of this function, so another function in the same file
    // cannot lend it constants.
    const end = sql.indexOf("$function$;", start);
    return { file, body: sql.slice(start, end < 0 ? undefined : end) };
  }
  throw new Error(`no migration defines public.${name}`);
}

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());

function constantsOf(body: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const match of body.matchAll(/\bc_([a-z_]+)\s+constant\s+int\s*:=\s*(\d+)/g)) {
    out[camel(match[1])] = Number(match[2]);
  }
  return out;
}

const FUNCTIONS = ["submit_review", "update_review"] as const;

for (const name of FUNCTIONS) {
  test(`${name} states the same limits as review-standards.ts`, () => {
    const { file, body } = latestDefinition(name);
    const inSql = constantsOf(body);
    assert.ok(Object.keys(inSql).length > 0, `${name} declares no limits at all`);
    for (const [key, value] of Object.entries(inSql)) {
      assert.ok(
        key in REVIEW_LIMITS,
        `${name} in supabase/migrations/${file} declares c_${key}, which review-standards.ts does not know`,
      );
      assert.equal(
        value,
        REVIEW_LIMITS[key as keyof typeof REVIEW_LIMITS],
        `${name} in supabase/migrations/${file} and src/lib/review-standards.ts disagree ` +
          `about ${key}. Change both, in the same pull request.`,
      );
    }
  });
}

test("every limit in review-standards.ts is enforced by the database", () => {
  const enforced = new Set(FUNCTIONS.flatMap((name) => Object.keys(constantsOf(latestDefinition(name).body))));
  const unenforced = Object.keys(REVIEW_LIMITS).filter((key) => !enforced.has(key));
  assert.deepEqual(
    unenforced,
    [],
    `${unenforced.join(", ")} is promised on the form but enforced by no database function.`,
  );
});

test("the review action never writes the reviews table directly", () => {
  // The tier, status and rate limit are decided inside submit_review. An
  // insert from the app would be refused by RLS today and would be the first
  // step to reopening that door tomorrow.
  const action = read("lib", "review-actions.ts");
  assert.doesNotMatch(action, /\.from\(\s*["']reviews["']\s*\)/);
  assert.match(action, /["']submit_review["']/);
  assert.match(action, /["']update_review["']/);
  assert.doesNotMatch(action, /\.(insert|update|upsert)\(/);
});
