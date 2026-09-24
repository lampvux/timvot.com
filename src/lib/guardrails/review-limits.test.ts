import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, read, readRoot } from "./source";
import { REVIEW_LIMITS } from "../review-standards";

/**
 * The review limits are written twice, and must agree.
 *
 * `submit_review` enforces them, because a direct RPC call skips the form;
 * `review-standards.ts` repeats them so the form can name the rule a draft
 * broke. A limit changed on one side only either rejects a review the form
 * promised would pass or tells an author a rule the database does not hold.
 */

function latestSubmitReview(): { file: string; sql: string } {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse();
  for (const file of files) {
    const sql = readRoot("supabase", "migrations", file);
    if (/create (or replace )?function public\.submit_review\(/.test(sql)) {
      return { file, sql };
    }
  }
  throw new Error("no migration defines public.submit_review");
}

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());

test("submit_review and review-standards.ts share one set of limits", () => {
  const { file, sql } = latestSubmitReview();
  const inSql: Record<string, number> = {};
  for (const match of sql.matchAll(/\bc_([a-z_]+)\s+constant\s+int\s*:=\s*(\d+)/g)) {
    inSql[camel(match[1])] = Number(match[2]);
  }
  assert.deepEqual(
    inSql,
    { ...REVIEW_LIMITS },
    `supabase/migrations/${file} and src/lib/review-standards.ts disagree ` +
      `about the review limits. Change both, in the same pull request.`,
  );
});

test("the review action never writes the reviews table directly", () => {
  // The tier, status and rate limit are decided inside submit_review. An
  // insert from the app would be refused by RLS today and would be the first
  // step to reopening that door tomorrow.
  const action = read("lib", "review-actions.ts");
  assert.doesNotMatch(action, /\.from\(\s*["']reviews["']\s*\)/);
  assert.match(action, /\.rpc\(\s*["']submit_review["']/);
});
