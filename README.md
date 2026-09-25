# timvot.com

**English** | [Tiếng Việt](README.vi.md)

A badminton racket and string catalogue for Vietnam, with spec comparisons, seller
prices, a racket finder, buying guides, watchlists, reviews, and seller tools.
Vietnamese (`vi`) is the default language; English (`en`) is also available.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase, and next-intl.
The public website runs from this directory. The separate [admin app](admin/README.md)
has its own dependencies and deployment.

## Quick start

Use **Node.js 24.x** and npm. From the repository root:

```bash
npm ci
npm run dev
```

Open [localhost:3000/vi](http://localhost:3000/vi) or
[localhost:3000/en](http://localhost:3000/en).

No environment file is needed to browse the built-in sample catalogue. Sign-in,
watchlist, review submission, and seller changes require Supabase.

## Connect Supabase (optional)

1. Copy [.env.example](.env.example) to `.env.local`.
2. Set the values for your development Supabase project:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

3. To apply database migrations, also set `DIRECT_URL` to a session-mode Postgres
   connection on port 5432, or set `SUPABASE_ACCESS_TOKEN`. Then run:

   ```bash
   npm run migrate:dry   # List migration files without changing the database
   npm run migrate       # Apply pending migrations
   ```

4. For sample data in a fresh development database:

   ```bash
   npm run seed:sql
   npm run migrate -- --file=supabase/seed.sql
   ```

5. Follow [authentication setup](docs/auth-setup.md) to configure callback URLs and
   optional Google/Facebook sign-in, then restart the dev server.

Keep `.env.local` private. `SUPABASE_SERVICE_ROLE_KEY` is only needed for privileged
scripts and admin operations; never expose it through a `NEXT_PUBLIC_` variable.
It cannot replace the migration credentials above.

## Everyday development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the public website with live reload |
| `npm run typecheck` | Check application and script types |
| `npm test` | Run library, security, scraper, and migration test suites |
| `npm run test:guides` | Run the guide worker and guide content tests |
| `npm run build` | Build the public website for production |
| `npm start` | Serve the production build locally |
| `npm run test:e2e` | Build and run Playwright browser tests with sample data |

Before your first browser test, run `npx playwright install chromium`.
Run type checks, relevant tests, and a production build before opening a pull request.
The admin app is checked separately; see its [setup guide](admin/README.md).

## Where to work

| Path | What belongs here |
| --- | --- |
| `src/app/[locale]/` | Public pages: rackets, strings, compare, finder, deals, guides, accounts, and sellers |
| `src/components/` | Shared UI; `ds/` contains design system components |
| `src/app/globals.css` | Global styles and design tokens |
| `src/lib/data/` | Catalogue queries, data mapping, and sample data |
| `src/lib/` | Domain types, Court Score, authentication, and business logic |
| `src/i18n/`, `messages/` | Locale routing and English/Vietnamese translations |
| `supabase/migrations/` | Database schema and access policies |
| `scripts/` | Scrapers, catalogue maintenance, migrations, and guide publishing |
| `e2e/` | Browser tests |
| `admin/` | Standalone operations console |

Update both translation files when changing interface copy. Keep data access in
`src/lib/data/` and add schema changes as migrations. Before changing Next.js code,
read the installed guides in `node_modules/next/dist/docs/`, as required by [AGENTS.md](AGENTS.md).

## Data and publishing

### Racket crawler and backup

Run from the repository root. For live backups, database sync, and image uploads,
set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

| Command | Purpose |
| --- | --- |
| `npm run backup` | Export a catalogue snapshot to `backups/backup-<timestamp>.json` |
| `npm run scrape:quick` | Crawl up to 3 pages per shop without browser verification; save JSON only |
| `npm run scrape` | Crawl all default shops with browser verification; save JSON only |
| `npm run scrape:sync` | Crawl, verify, and sync racket prices and stock to Supabase |
| `npm run scrape:refresh` | Crawl and sync without browser verification |
| `npm run scrape:images` | Crawl racket galleries and upload images to Supabase |
| `npm run market:refresh` | Recompute stored Court Scores after catalogue changes |

Before using browser verification, run `npx playwright install chromium`.
The default shops are VNB, QV Badminton, FBShop, and HVShop. To target one shop:

```bash
npm run scrape -- --site=vnb --pages=3 --no-verify
```

Racket scrape output is saved to `scripts/scraper/output/rackets.json`.
Take a backup before syncing changes. Without Supabase credentials, `backup`
exports sample data only. Check its warnings and table counts: failed table reads
can produce a partial snapshot. These snapshots exclude Auth users and Storage
files; see [full project migration](docs/supabase-instance-migration.md) for those.

### Scheduled runner

The [daily crawler and backup workflow](.github/workflows/daily-scraper.yml) runs on
a GitHub-hosted Ubuntu runner at **01:00 UTC / 08:00 Vietnam time**. It syncs racket
offers, imports Venson catalogue entries, refreshes scores, crawls selected image
providers, audits images, and creates a post-sync backup.

To run it manually, open GitHub **Actions → Shuttlecraft Daily Scraper & Backup Sync
→ Run workflow**. That is the workflow's current name. Configure repository secrets
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; its benchmark steps also
use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `DIRECT_URL`. Optional
`REVALIDATE_URL` / `REVALIDATE_SECRET` refresh the site's cache after sync.

Download `daily-db-backup-<run-number>` from the run's artifacts; retention is
30 days. The manual `sync_db` option controls only the retailer scrape step;
catalogue imports, score refreshes, and image uploads still run.

### Strings and guides

- `npm run scrape:strings` collects string prices and stock.
- `npm run scrape:strings:sync` writes to the configured database using the same
  Supabase URL and service-role key.
- Guide generation has its own setup: [guide publishing](docs/ai-guides-operations.md).

All available commands are listed in [package.json](package.json).

## Deployment

The public website and admin app deploy as separate Vercel projects. Use the
repository root for the website and `admin/` for the console. Set the public site's
`NEXT_PUBLIC_SITE_URL` to `https://timvot.com` in production.

The manual [production workflow](.github/workflows/deploy-production.yml) builds a
selected commit from `main` and deploys it. It requires the `VERCEL_TOKEN` repository
secret and the `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` repository variables.

For deployment work, installing the Vercel CLI with `npm i -g vercel` is strongly
recommended for `vercel env pull`, `vercel deploy`, and `vercel logs`.

## More documentation

- [Authentication and social sign-in](docs/auth-setup.md)
- [Admin setup and deployment](admin/README.md)
- [Guide publishing](docs/ai-guides-operations.md)
- [Racket image backfill](docs/retailer-image-backfill.md)
- [Supabase project migration](docs/supabase-instance-migration.md)
