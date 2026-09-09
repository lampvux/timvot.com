import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOptions,
  projectRefFromApiUrl,
  projectRefFromDatabaseUrl,
  safeDatabaseLabel,
} from "./migrate-supabase-project";

test("extracts project refs from API and database URLs", () => {
  assert.equal(projectRefFromApiUrl("https://source-ref.supabase.co"), "source-ref");
  assert.equal(
    projectRefFromDatabaseUrl("postgresql://postgres:secret@db.direct-ref.supabase.co:5432/postgres"),
    "direct-ref",
  );
  assert.equal(
    projectRefFromDatabaseUrl("postgresql://postgres.pooler-ref:secret@aws-0-us.pooler.supabase.com:5432/postgres"),
    "pooler-ref",
  );
});

test("redacts database passwords", () => {
  const label = safeDatabaseLabel(
    "postgresql://postgres.project-ref:very-secret@aws-0-us.pooler.supabase.com:5432/postgres",
  );
  assert.equal(label.includes("very-secret"), false);
  assert.equal(label.includes("project-ref"), true);
});

test("parses phased migration options", () => {
  const options = parseOptions([
    "storage",
    "--confirm-target=target-ref",
    "--bucket=racket-images,racket-images-yonex",
    "--concurrency=7",
  ]);
  assert.equal(options.action, "storage");
  assert.equal(options.confirmTarget, "target-ref");
  assert.deepEqual(options.buckets, ["racket-images", "racket-images-yonex"]);
  assert.equal(options.concurrency, 7);
  assert.equal(options.allowArtifactEdits, false);
  assert.equal(options.historyOnly, false);
});

test("parses explicit restore recovery flags", () => {
  const options = parseOptions([
    "restore",
    "--dir=backups/example",
    "--confirm-target=target-ref",
    "--allow-artifact-edits",
    "--history-only",
  ]);
  assert.equal(options.allowArtifactEdits, true);
  assert.equal(options.historyOnly, true);
});
