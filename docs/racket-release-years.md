# Correct racket release years through a CSV

`scripts/racket-release-years.ts` exports the entire catalogue, validates a reviewed CSV, and imports verified corrections. The LLM reviews the **file** in a chat or local model interface. The script has no OpenAI integration, AI API calls, model dependencies, or AI credentials. Only export/import connect to PostgreSQL.

The supplied `data/racket-release-years.csv` contains all 3,171 rackets in the live catalogue on 24 September 2026. It includes researched corrections with source URLs, but **the research is incomplete**: rows marked `unreviewed` or `unresolved` retain their original values and will not be imported. Run `validate` for current coverage; do not treat the remaining 2026 values as confirmed release years.

The initial import verified 149 rows, corrected 146 database years, and found 3 already correct. A second evidence pass recorded 115 additional findings. During that work one previously verified duplicate was deleted from the live catalogue and two racket names were updated, so the synchronized current file contains 263 verified rows, 2,904 unreviewed rows, and 4 unresolved rows. The second import corrected another 101 database years and found 162 verified rows already correct. A full live readback matched all 263 verified targets and confirmed that all 2,908 skipped rows retained their pre-import years.

The rollback files are `backups/racket-release-years/2026-09-24T07-28-28-477Z-rollback.csv` for the initial import and `backups/racket-release-years/2026-09-24T11-33-20-193Z-rollback.csv` for the second import. The second pass evidence is also retained in `data/racket-release-year-findings.json`.

The existing retailer scraper defaults new records to the current calendar year. That is the crawl year, not evidence of a product launch. Its insert-only upsert preserves corrected existing rows, but future additions still need this review.

## Commands

Run from the repository root with the project's installed dependencies. Export/import use the existing `.env` / `.env.local` loader and select the first configured connection string from `SUPABASE_DB_URL`, `DIRECT_URL`, and `DATABASE_URL`. Use a database connection, not a Supabase REST URL. Validation needs no credentials or network access.

```sh
# Export every racket, including rows beyond Supabase's REST pagination limit.
npm run rackets:years -- export --file=data/racket-release-years-fresh.csv

# After the LLM edits the file, check its format and review coverage offline.
npm run rackets:years -- validate --file=data/racket-release-years-fresh.csv

# Preview the changes against the current database; no writes or backups.
npm run rackets:years -- import --file=data/racket-release-years-fresh.csv

# Apply verified changes in one transaction and save a rollback CSV first.
npm run rackets:years -- import --file=data/racket-release-years-fresh.csv --apply
```

Omitting `--file` selects the supplied `data/racket-release-years.csv`. Export refuses to overwrite a file, so choose a new filename when exporting again. Import defaults to a read-only preview; `--apply` is required to write.

## CSV contract

The first columns are `brand,name,slug,release_year`. The remaining columns make imports auditable:

| Column | Meaning |
| --- | --- |
| `id`, `brand_id` | Database identity; preserve exactly. |
| `original_release_year` | Value at export; preserve exactly. |
| `status` | `unreviewed`, `verified`, or `unresolved`. Only `verified` rows participate in imports. |
| `source_url` | Evidence for the year. Verified rows require an HTTP(S) URL; separate multiple URLs with ` | `. |
| `notes` | Brief evidence or explanation of uncertainty. Required for verified rows. |

Keep brand, name, slug, IDs, and original year unchanged. Edit only `release_year`, `status`, `source_url`, and `notes`. Keep every row and column. UTF-8, quoted commas/newlines, escaped quotes, CRLF, and a UTF-8 BOM are supported. Duplicate IDs/slugs, malformed records, invalid years, undocumented verified rows, and changes to unreviewed/unresolved rows fail validation.

`release_year` means the first retail release of the **named model or explicitly named edition**. For a plain model name without a generation, use the first release under that model name and state that interpretation in the notes. A named generation, color refresh, collaboration, or limited edition needs its own evidence. Do not use an announcement's publication year if its actual release is in the following year. A current catalogue, review date, regional restock, testing registration, or model number is insufficient evidence by itself.

The database currently requires a non-null year. When identification or evidence is insufficient, preserve the original year and mark `unresolved`; that preserved number is not a claim that the year is correct. One exported Kawasaki row has no model name and cannot be resolved from these fields.

## File review prompt

Give the CSV and this prompt to a file-capable LLM interface of your choice. This is a separate file-processing step; no model API is called by this repository's script. Large catalogues can be reviewed one brand at a time in the same file.

```text
Review the attached racket-release-years CSV and edit the file itself.
Do not call an LLM provider API. Work only on the catalogue fields provided;
database credentials are not needed and must not be shared.

For each unreviewed/unresolved racket, establish the first retail release
year of its exact named model/edition. Prefer dated manufacturer launch
announcements. Where necessary, corroborate explicit release dates from
reliable distributors or retailers. Distinguish model launches from later
generations, special editions, color refreshes, and regional availability.
For a plain model name with no generation, use the first release under
that name and explain that interpretation. Never infer the year merely
from a model number, current catalogue, page timestamp, or today's year.

Edit only release_year, status, source_url, and notes. Preserve all rows,
headers, brand/name/slug, id, brand_id, and original_release_year exactly.
When evidence supports the year, set status=verified, add the source URL
(separate multiple URLs with " | "), and add a concise evidence note.
When evidence or model identity is insufficient, set status=unresolved,
leave release_year equal to original_release_year, and explain the gap.
Never invent a year or a source. Leave rows you have not investigated as
unreviewed. Save valid UTF-8 CSV and report verified/unresolved/unreviewed
counts, explicitly stating any incomplete coverage.
```

The validator checks structure and required evidence fields; it does **not** verify the truth of a source or automatically research dates. Review the CSV before importing.

## Import safeguards and rollback

The importer matches by ID and checks brand, brand ID, name, slug, and the exported year. Deleted/renamed records or conflicting year edits abort the whole batch. Rows already at the target year are skipped, so rerunning an applied file is safe. Applying locks the relevant racket and brand rows, writes a rollback file before changing data, and checks the returned years and affected-row count before committing. The SQL assigns only `release_year`.

Backups are written to `backups/racket-release-years/<timestamp>-rollback.csv` and ignored by Git. The command prints the exact path. A backup may exist even after an aborted transaction; preview it to check the live state before restoring.

```sh
npm run rackets:years -- import --file=backups/racket-release-years/<timestamp>-rollback.csv
npm run rackets:years -- import --file=backups/racket-release-years/<timestamp>-rollback.csv --apply
```

Rollback uses the same identity/staleness checks and restores the pre-import values. Keep the rollback file until the corrections have been accepted.

## Verification

```sh
npm run test:catalogue
npm run typecheck
```

The release-year tests cover CSV round trips, malformed/duplicate inputs, evidence requirements, empty model names, stale identities/years, idempotency, reversible backups, read-only previews, row locking, and rollback after backup/SQL/verification failures.
