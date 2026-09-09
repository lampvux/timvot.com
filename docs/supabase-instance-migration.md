# Supabase instance migration runbook

This runbook moves Shuttlecraft from one hosted Supabase project to another. It
uses a logical PostgreSQL export/restore for the database and a separate API
copy for the Storage object bytes. Run it from the repository root on a trusted
machine.

The process is intentionally manual and phased. Do not run the next phase until
the previous one has completed and its output has been reviewed.

> If the source is on a paid plan with physical backups enabled, Supabase
> recommends **Database → Backups → Restore to a New Project** instead. That
> copies the database and encryption root key, but Storage objects and project
> settings still need manual work. See Supabase's
> [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
> guide.

## What this migration covers

| Area | How it moves |
| --- | --- |
| Public schema, functions, RLS, triggers, indexes | `schema.sql` logical dump |
| Public data | `data.sql` logical dump |
| Auth users, identities, and password hashes | Managed-schema data in `data.sql` |
| Database roles | `roles.sql` |
| Supabase CLI migration history | Separate history schema/data dumps |
| Storage bucket metadata and policies | Database dump |
| Storage object bytes | `storage` phase through both projects' Storage APIs |
| Persisted Shuttlecraft image URLs | Rewritten from the source project URL to the target after a successful object copy |

It does **not** automatically copy dashboard-only configuration: API keys, Auth
providers and URL settings, SMTP/templates, Realtime publications, Edge
Functions and their secrets, database webhooks, custom database settings, read
replicas, or external OAuth-provider callback configuration.

The old `npm run backup` and `npm run restore` commands are catalogue recovery
tools. They cover only selected public tables and must not be used for a full
Supabase project migration.

## Phase 0 — choose the window and prepare the target

This is a snapshot migration, not continuous replication. Plan a maintenance
window long enough to export the database, restore it, copy every Storage
object, verify, and switch the application configuration.

1. Create a new, otherwise empty Supabase project. Record its project ref and
   database password.
2. In both projects, use **Connect** to copy the **Session pooler** URL on port
   `5432`. Use the direct database URL only when the migration machine has IPv6
   connectivity or the project has the IPv4 add-on. Do not use transaction mode
   on port `6543` for this restore.
3. In the target, enable every non-default extension used by the source. The
   preflight prints the source extension list. Enable Database Webhooks too if
   the source uses them.
4. Do not apply `supabase/migrations`, run the seed, create users, or upload
   files to the target. The restore expects a clean project.
5. If the source uses Supabase Vault or encrypted columns, stop and use the
   physical “Restore to a New Project” path if possible. A manual logical dump
   does not carry the source encryption root key; copied secrets will not be
   decryptable without Supabase's separate key-copy procedure.

Official background: [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Phase 1 — install local prerequisites

You need:

- Node.js 20 or newer. This repository expects Node.js 24.
- The repository dependencies (`npm install`). `supabase` is pinned as a dev
  dependency; the helper invokes its JavaScript entry point directly through
  Node so Windows does not need to launch the `npx.cmd` shell shim.
- Docker Desktop, with its daemon running. The Supabase CLI uses a containerized
  `pg_dump`.
- PostgreSQL's `psql` client on `PATH`, or Docker. When native `psql` is absent,
  the helper runs `postgres:17-alpine` as a temporary client container.

Check the three command-line tools:

```powershell
node node_modules/supabase/dist/supabase.js --version
docker info
psql --version
```

The Supabase CLI installation method is documented in
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npx&queryGroups=platform).

## Phase 2 — create the private migration configuration

Copy the safe template:

```powershell
Copy-Item .env.migration.example .env.migration
```

Open `.env.migration` in an editor and fill all six values:

```dotenv
MIGRATION_SOURCE_DB_URL=postgresql://postgres.SOURCE_REF:SOURCE_PASSWORD@SOURCE_POOLER_HOST:5432/postgres
MIGRATION_TARGET_DB_URL=postgresql://postgres.TARGET_REF:TARGET_PASSWORD@TARGET_POOLER_HOST:5432/postgres
MIGRATION_SOURCE_URL=https://SOURCE_REF.supabase.co
MIGRATION_TARGET_URL=https://TARGET_REF.supabase.co
MIGRATION_SOURCE_SERVICE_ROLE_KEY=
MIGRATION_TARGET_SERVICE_ROLE_KEY=
```

Get each secret/service-role key from that project's API settings. These keys
bypass RLS and must never be prefixed with `NEXT_PUBLIC_`, pasted into chat, or
committed. `.env.migration` is ignored by Git. The helper deliberately does not
load the application's `.env`, which prevents an accidental source/target mix.

Percent-encode special characters in database passwords inside the URL. For
example, `@` becomes `%40`, `#` becomes `%23`, and `%` becomes `%25`.

## Phase 3 — run the read-only preflight

```powershell
npm run supabase:migrate -- preflight
```

Preflight verifies that:

- source and target refs are different;
- Node, the pinned Supabase CLI, Docker, and `psql` are usable;
- both PostgreSQL connections work;
- both service-role keys can list Storage buckets;
- the target's current critical row counts are visible.

Review the printed source extension list. A normal new target should have no
rows in public tables, `auth.users`, or `storage.objects`. If it does, create a
fresh target rather than trying to merge two projects.

## Phase 4 — freeze writes and export

Immediately before exporting, freeze every path that can write to the source:

- public sign-up, profile, watchlist, review, and seller workflows;
- the standalone admin console;
- `scrape:sync`, `scrape:strings:sync`, `scrape:images`, seeding, and migration jobs;
- any dashboard SQL work or external integration that writes to the database.

Keep the source available for reads if that suits the maintenance plan, but do
not unfreeze writes until cutover or rollback. The helper takes several logical
dumps; a write freeze keeps them mutually consistent.

Choose a new backup directory and export:

```powershell
$MigrationDir = "backups/supabase-migration-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
npm run supabase:migrate -- export --dir="$MigrationDir"
```

The directory contains:

```text
roles.sql
schema.sql
data.sql
history_schema.sql
history_data.sql
manifest.json
```

If the source has never used Supabase CLI migrations, it may not have a
`supabase_migrations` schema. The helper records valid comment-only history
artifacts in that case; the database, Auth, and Storage migration are unaffected.

The helper also removes the platform-owned `log_min_messages` parameter grant
from `roles.sql`; hosted Supabase targets reject that internal grant, and the
target project already manages it independently.

For portability between Supabase projects, `pg_trgm` and its index operator
classes are normalized to the managed `extensions` schema.

Storage object paths are enumerated from `storage.objects` over the source
database connection. This avoids recursive Storage API listing timeouts on
large or deeply nested buckets; object bytes still move through the Storage API.

`manifest.json` records SHA-256 checksums. Treat the whole directory as highly
sensitive: the SQL can contain personal data, Auth records, password hashes,
tokens, and Storage metadata. It is Git-ignored; encrypt it before copying it
elsewhere and delete it according to your retention policy after the migration.

## Phase 5 — restore the database

Use the target ref shown in its URL. The exact ref is required as a guardrail:

```powershell
npm run supabase:migrate -- restore --dir="$MigrationDir" --confirm-target=TARGET_REF
```

The main restore uses `psql --single-transaction` with `ON_ERROR_STOP`. It also
sets `session_replication_role` to `replica` while loading data so triggers do
not duplicate derived or encrypted values. If a statement fails, the main
database transaction rolls back.

The helper refuses a populated target. Do not reach for
`--allow-nonempty-target` as a normal migration option; it exists only for a
retry whose target state you have personally inspected.

### Documented role/ownership restore errors

Supabase documents two logical-restore compatibility fixes:

1. If `roles.sql` fails while granting `postgres` to `cli_login_postgres`,
   comment out only the failing `GRANT "postgres" TO "cli_login_postgres" ...`
   line.
2. If `schema.sql` reports an ownership error involving `supabase_admin`,
   comment out only the failing `ALTER ... OWNER TO "supabase_admin"` line(s).

The failed main restore will have rolled back. Review the edit, then retry with
the explicit checksum override:

```powershell
npm run supabase:migrate -- restore --dir="$MigrationDir" --confirm-target=TARGET_REF --allow-artifact-edits
```

If the main database restore succeeded but only the separate migration-history
restore failed, fix the history SQL and resume without replaying the main dump:

```powershell
npm run supabase:migrate -- restore --dir="$MigrationDir" --confirm-target=TARGET_REF --history-only --allow-artifact-edits
```

If you created custom roles with `LOGIN`, logical dumps do not preserve their
passwords. Set new passwords manually after the restore.

## Phase 6 — reproduce dashboard configuration

Before testing Auth or enabling traffic, compare the source and target
dashboards side by side.

### Authentication

- Copy email/password policy, confirm-email behavior, password rules, rate
  limits, CAPTCHA, hooks, SMTP, and email templates.
- Set **Authentication → URL Configuration → Site URL** to the production app
  URL and add `http://localhost:3000/auth/callback` plus
  `https://YOUR_DOMAIN/auth/callback` to Redirect URLs.
- Re-enable Google/Facebook providers and copy their client credentials.
- In Google and Facebook, add the new Supabase callback
  `https://TARGET_REF.supabase.co/auth/v1/callback`. Keep the old callback until
  rollback is no longer possible.

Auth users and password hashes are in the logical restore, so existing users
can sign in with the same passwords. Existing sessions are different: each
project normally has a different JWT signing secret, so old cookies/tokens will
be rejected and users must sign in again. That clean re-login is the recommended
default. If seamless token continuity is a hard requirement, review Supabase's
[Auth user migration guidance](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
before cutover; changing a target JWT secret regenerates its API keys.

For Shuttlecraft's full provider walkthrough, see [auth-setup.md](auth-setup.md).

### Other project settings

- Re-enable Realtime publication for any tables that used it.
- Recreate Database Webhooks, Cron jobs, external integrations, and custom
  database settings.
- Deploy any dashboard-only Edge Functions and set their secrets. This
  repository currently has no `supabase/functions` directory, so there is
  nothing versioned here for the helper to deploy.
- Recheck extension versions, network restrictions, SSL enforcement, custom
  domains, read replicas, and compute/disk sizing.

Storage bucket visibility, size limits, MIME allow-lists, and object RLS are
handled by the database and Storage phases, but verify them in the dashboard.

## Phase 7 — copy Storage object bytes

The database restore moves `storage.buckets` and `storage.objects` metadata; it
does not move the actual files. Copy the bytes with:

```powershell
npm run supabase:migrate -- storage --confirm-target=TARGET_REF
```

The phase:

- walks nested folders with pagination;
- copies up to four files concurrently by default;
- retries each download/upload three times;
- preserves content type, cache control, public/private state, file-size limit,
  and allowed MIME types;
- upserts target paths, so a failed run can be rerun safely;
- writes a JSON failure report under `backups/` if any object still fails;
- after every object succeeds, rewrites `racket_images.public_url`,
  `racket_images.thumb_url`, `rackets.hero_image_url`, and
  `rackets.hero_thumb_url` from the source Supabase hostname to the target.

To migrate or retry one or more buckets:

```powershell
npm run supabase:migrate -- storage --confirm-target=TARGET_REF --bucket=racket-images,racket-images-yonex
```

If the service is rate-limiting or the connection is unstable, lower
`--concurrency=2`. Use `--skip-url-rewrite` only if a custom Storage domain makes
the source and target URLs intentionally identical or you have another reviewed
URL-rewrite plan.

## Phase 8 — verify before cutover

Keep writes frozen and run:

```powershell
npm run supabase:migrate -- verify
```

The verifier compares exact row counts for every public table plus
`auth.users`, `auth.identities`, `storage.buckets`, and `storage.objects`. It
also recursively compares every source/target Storage path and reported byte
size, and fails if a Shuttlecraft row still contains the source Storage URL.

This is an inventory check, not a cryptographic hash of every remote object.
Also perform these application checks against a deployment configured with the
target project:

1. Open Vietnamese and English catalogue pages; confirm cards, galleries, and
   thumbnails load from `TARGET_REF.supabase.co`.
2. Sign in with an existing email/password account. A fresh sign-in is expected
   if the JWT secret changed.
3. Confirm the account profile and watchlist.
4. In the admin console, read catalogue data, upload then delete a disposable
   image, and inspect the audit log.
5. With a seller test account, read its dashboard and exercise a reversible
   listing edit.
6. Exercise Google/Facebook sign-in if enabled, including the return through
   `/auth/callback`.
7. Inspect logs for Auth, PostgREST, Storage, RLS, or foreign-key errors.

Do not dismiss a count mismatch by rerunning blindly. It usually means writes
were not fully frozen, the target was not empty, or one dump/restore step failed.

## Phase 9 — cut over

Update both the storefront and `admin/` deployment environments:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TARGET_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=TARGET_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=TARGET_SECRET_OR_SERVICE_ROLE_KEY
```

Update `DIRECT_URL`, `SUPABASE_DB_URL`, and any CI/scraper secrets that still
point to the source. Keep `SUPABASE_IMAGE_BUCKET=racket-images` unless you used a
different bucket name. Redeploy both apps because `NEXT_PUBLIC_` values are
embedded at build time.

In Vercel, update the storefront project and the separate `admin/` project,
checking that each variable is scoped to the intended Production/Preview/
Development environments. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and mark
it sensitive; never give it a `NEXT_PUBLIC_` prefix. The Vercel CLI is not
installed on this machine. Installing it with `npm i -g vercel` is recommended
if you want to audit and update both projects with `vercel env` instead of using
the dashboard. Be aware that `vercel env pull` replaces its destination file;
do not point it at `.env.migration`.

Then:

1. Repeat the smoke tests on the production URLs.
2. Unfreeze writes on the target only.
3. Watch Auth, database, and Storage logs closely.
4. Keep the source project intact and read-only for an agreed rollback window.
   Do not delete it immediately.

## Rollback

Before target writes are enabled, rollback is simply a configuration switch
back to the source followed by redeployment.

After target writes are enabled, the source is stale. Freeze target writes
first, assess and export the target-side changes, and reconcile them before
switching back. Never point live writers at both projects.

## Troubleshooting quick reference

| Symptom | Action |
| --- | --- |
| `spawnSync npx.cmd EINVAL` | Update to the current helper; it invokes the pinned CLI through Node and does not spawn the Windows batch shim |
| `docker` missing or daemon unavailable | Install/start Docker Desktop, then rerun `preflight` |
| `psql` unavailable | Install PostgreSQL client tools and add their `bin` directory to `PATH` |
| Direct DB hostname cannot resolve/connect | Use the Session pooler URL on port `5432` |
| Password containing `@`, `#`, `%`, `/`, or `:` breaks URL parsing | Percent-encode it in `.env.migration` |
| Target is not empty | Use a fresh project; only use the override after inspecting a known retry state |
| Artifact checksum mismatch | Restore the original export or use `--allow-artifact-edits` only for a reviewed Supabase-documented fix |
| Storage failure report created | Fix the credential/network/limit issue and rerun `storage`; uploads are upserts |
| Verify shows source/target count mismatch | Keep writes frozen and identify the specific table before retrying |
| Existing users cannot sign in | Recheck Auth settings; a new JWT invalidates sessions but does not change restored password hashes |
| Images still use the old hostname | Rerun `storage` without `--skip-url-rewrite`, then rerun `verify` |
