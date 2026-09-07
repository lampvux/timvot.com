# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev            # Next dev server on :3000 — runs with no env vars at all
npm run build          # production build
npm run typecheck      # tsc --noEmit — the static gate for src/ and scripts/
```

There is no ESLint config. `npm run typecheck` is what "does it pass" means for
`src/`; run it after any change to `src/` or `scripts/`. The node:test suites under
`scripts/` are the rest of the gate — no framework, just `tsx --test`:

```bash
npm run test:scraper         # scraper: per-shop failure isolation, run report, abort path
npm run test:image-scraper   # manufacturer gallery crawl and image ownership
npm run test:string-scraper  # string catalogue
```

Data and schema:

```bash
npm run migrate:dry    # list pending supabase/migrations/*.sql, apply nothing
npm run migrate        # apply them (needs SUPABASE_ACCESS_TOKEN or DIRECT_URL/SUPABASE_DB_URL)
npm run seed:sql       # regenerate supabase/seed.sql from src/lib/data/seed.ts
npm run seed:db        # push the seed straight into Postgres
npm run backup         # dump tables to backups/*.json ; npm run restore [file] [--dry-run]
npm run market:refresh # recompute racket_scores (Court Score) from the catalogue
npx tsx scripts/score-report.ts   # Court Score for every seeded racket
```

Measuring, before changing anything about the read path:

```bash
npm run benchmark                   # every hot path, 5 runs, sql / postgrest / js layers
npm run benchmark -- --explain      # plus EXPLAIN (ANALYZE, BUFFERS) for the SQL scenarios
npm run benchmark -- --only=catalogue --runs=10
npm run benchmark -- --markdown --json=bench.json
```

Read the `baseline:round trip` row first: it is the latency to the database
region, and from a laptop it is most of every `sql` number. Subtract it before
concluding a query is slow. `today` rows are what the app does now, `proposed`
rows are the alternative — the table exists so a read-path change is argued from
a number rather than from a guess.

Scrapers (full flag tables live in `README.md`):

```bash
npm run scrape:quick   # 3 pages per site, no browser verification — for iterating
npm run scrape         # full walk + Playwright verification
npm run scrape:sync    # also upsert into Postgres (needs SUPABASE_SERVICE_ROLE_KEY)
npm run scrape:sql     # emit supabase/scraped-catalogue.sql instead (no key needed)
npm run scrape:images:dry   # manufacturer gallery crawl, match-only, no credentials
npx tsx scripts/scraper/forza-catalogue.ts   # manufacturer pages as catalogue rows,
npx tsx scripts/scraper/yonex-catalogue.ts   #   report-only; --sync-db to write
npx tsx scripts/scraper/fleet-catalogue.ts   #   fleet.vn, the same shape
```

`npm run scrape -- --site=vnb --pages=5 --verbose` is the shape for narrowing a run;
`--verify-only` re-checks a scrape already on disk without walking the sites again.

**A shop that fails costs that shop and nothing else.** Four independent storefronts
means four independent ways for a night to go wrong, so `guard.ts` runs each one so
that nothing it does can reach the shops after it: an unexpected throw becomes a
skipped shop rather than a rejection out of the site loop, and a shop that hangs is
abandoned when `--site-timeout` (default 30 min) runs out, with its in-flight requests
aborted through the signal threaded down to `fetchWithRetry`. A skipped shop is named
in the report (`report.ts`, which also writes the GitHub step summary), keeps every
offer it last published, and does not stop the run — `runVerdict` fails only when no
source was selected, when *every* source failed, or when the database write itself did.
Browser verification never fails the run either. That policy is what keeps the nightly
workflow's later steps — image crawl, ownership audit, backup — running, so do not
reintroduce a `process.exitCode = 1` per failed source.

The three `*-catalogue.ts` scripts are not `sites/` adapters: a `sites/` adapter reads a
shop and yields offers, which needs a seller row, a stock state and the nightly sweep that
retires what a shop stopped listing. They write rackets with no offers, and never touch a
racket the catalogue already holds. Whether it *does* hold one is decided by
`images/match.ts`, not by the row id — the id comes from the manufacturer's spelling and
the catalogue's came from retailers, so `ASTROX 88 S PRO` and `Astrox 88S Pro` are two ids
for one frame. `fleet-catalogue.ts` also passes the `fleet-vn` provider's `titleNoise` and
`modelAliases` through that match, so the importer and the gallery crawler cannot disagree
about which pages are duplicates. fleet.vn *does* quote prices; they land in `rackets.msrp`
where a distributor's list price belongs, never as an offer.

`supabase db push` is not used — it needs an interactive password prompt.
`scripts/migrate.ts` runs the same SQL over the Management API or a direct
`postgres://` URL and tracks applied files in a `schema_migrations` table. A
service-role key is deliberately rejected there: it authenticates against PostgREST,
which runs no DDL.

## Architecture

Next.js 16 App Router (Turbopack), React 19, Tailwind v4, Supabase, `next-intl`.
Read `node_modules/next/dist/docs/` before writing framework code — this Next version
diverges from training data (middleware is `src/proxy.ts`, `params` is a Promise).

**One read path.** `src/lib/data/repository.ts` is the only module that fetches
catalogue data. It loads a single `Snapshot` per request (deduped with React `cache`)
from Supabase when the keys are present and from `src/lib/data/seed.ts` when they are
not — same shapes either way, so no caller branches on which. Never add a second data
path; extend the repository instead. Derived values (Court Score, lowest price, seller
count, balance type) are computed there, so pages receive `RacketWithMarket`, not rows.

Every table read there goes through `selectAll`, which pages with `range` until a short
page arrives. PostgREST caps a response at 1000 rows and reports no error when it
truncates, so a plain `.select()` silently returned the first 1000 of 3037 rackets and
404ed every detail page beyond it. Five of the seven tables are over the cap. A new
`.select()` without `selectAll` — or with `selectAll` but no unique `.order()` to page
against — reintroduces that.

**The catalogue listing paginates in Postgres, not in JavaScript.**
`getCatalogPage(filters, page, pageSize)` is the only function `/rackets` calls
for results. It reads the `racket_market` view — one row per racket, with every
filter and sort key resolved into a column — carrying the predicates, the
ordering, `count: 'exact'` and one page's `.range()`, then hydrates just those
24 ids. Reading the snapshot and slicing the array instead measured ~9.3 s and
7.4 MB to render 24 cards; the view answers the same page in ~5 ms of database
work. Court Score is the one value the view cannot compute — `court-score.ts` is
the published methodology and must stay the only definition — so
`scripts/refresh-market.ts` computes it with that module and stores the result
in `racket_scores`, which the nightly workflow refreshes after each sync.

The in-memory route still exists as `getCatalogPage`'s own degraded mode, taken
when the view cannot answer (unprovisioned project, database behind the
migration, any query error) and logged once with the migration to apply. That is
what lets the code deploy before the migration. It is not licence to add a second
read path: new catalogue reads extend the view.

Facet counts are their own `use cache` scope keyed on the filters *without* the
page, so paging a filtered catalogue reuses one entry instead of recomputing the
same four tallies per page.

**`src/lib/types.ts` is the schema.** Field names there become the Postgres columns,
the filter facets, the comparison rows and the Finder inputs. Renaming one is a
migration touching `supabase/migrations/`, `mappers.ts`, `seed.ts` and the scraper —
not a refactor.

**`src/lib/data/mappers.ts` is the only file that knows the DB dialect.** Postgres is
snake_case and splits localised text into `_en`/`_vi` column pairs; the domain objects
are camelCase and carry `{ en, vi }` together. Keep that knowledge in mappers, and keep
`RACKET_SELECT` in sync when adding columns.

**`src/lib/court-score.ts` reads no commercial data.** 50% deterministic spec profile,
50% verified-review player score (weighted 3×/2×/1× by tier). Nothing in the file may
read a seller, offer, price or promotion — that is the product claim, published on
`/methodology`. Under five verified reviews, `courtScore` is `null` and the UI shows
"spec profile only"; do not substitute the spec half for a total. A coefficient change
has to be reflected on the methodology page.

**Filters live in the URL** (`src/lib/filters.ts`, keys in `SEARCH_KEYS`), never in
component state, so a filtered catalogue survives being pasted into a chat and renders
server-side.

**Supabase clients** (`src/lib/supabase/`): `createClient()` binds request cookies and
falls back to `createStaticClient()` inside static contexts; both return `null` when
unconfigured, and every caller must handle that branch — that is what keeps the seed
fallback honest. `proxy.ts` refreshes the session onto the response next-intl already
produced, so there is one proxy file rather than two competing ones.

**i18n.** `vi` is default, `en` available, `localePrefix: "always"`. `/auth` is
excluded from the proxy matcher on purpose: next-intl would rewrite
`/auth/callback?code=…` to `/vi/auth/callback?code=…`, 404ing every OAuth and
email-confirmation redirect with the one-time code already spent. If sign-in starts
404ing, look there first. `/auth/callback` accepts a `next` param only when it starts
with a single slash — `//` or `/\` reads as a host and makes it an open redirect.
Model names and spec codes are never translated. UI strings live in
`messages/{vi,en}.json`.

**Auth surface area is deliberately small.** Browsing, comparing and the Finder require
no account; only watchlist, price alerts and reviews do. Keep it that way. OAuth buttons
render from `NEXT_PUBLIC_AUTH_PROVIDERS` and the list is re-checked server-side in
`signInWithProvider`. Provider secrets live in the Supabase dashboard, never here.
Walkthrough: `docs/auth-setup.md`.

**Scrapers** (`scripts/scraper/`) are node-only (`tsx`), never imported by the app.
Colourways are variants, not models (`colourway.ts`): strip only a *trailing* run of
known colour words, and only while a model identifier remains — `Ryuga CLS C` and
`CLS J` are different rackets. Matching in `images/match.ts` is prefix-based and
*refuses* rather than guessing; an ambiguous match is reported, not taken. Verification
(`verify.ts`) runs after the scrape is already written to disk, so a flaky Chromium
launch cannot cost a multi-minute walk. A price a source publishes as "liên hệ" is
counted and reported, never invented.

**Seed data is generated, not edited twice.** Change `src/lib/data/seed.ts`, then
`npm run seed:sql`. Hand-editing `supabase/seed.sql` desynchronises Postgres from the
no-database fallback.

**Security.** RLS is on for every table. Catalogue writes are admin-only, sellers manage
their own offers but never their own tier, watchlists are private, and sellers attach an
offer to a catalogued variant rather than creating products — that is what keeps the
catalogue clean. Storage buckets matching `racket-images%` are public-read, admin-write.

## Performance rules the code enforces

The catalogue is 3010 rackets, 3265 variants, 5281 offers and a price_points table
that grows by ~3265 rows on every `scrape:refresh`. Every rule below exists because
that scale breaks something a smaller catalogue would have hidden. Check the whole
list before adding a feature — a new page that reuses the existing helpers inherits
their costs, it does not escape them.

**Never scan a snapshot array inside a loop over another one.** `enrich` runs once
per racket; a `snapshot.history.filter(...)` inside it is 3010 × the price table and
grows every time the scraper runs. Build a `Map` keyed by `racketId` or `variantId`
once per snapshot, then look up. The same applies to `getDeals`, `getOffersForRacket`,
and anything new: index first, then iterate. If a helper is O(n×m) it must be
rewritten before it ships, not after it is slow.

**Nothing in `[locale]/layout.tsx` may read `cookies()`, `headers()` or
`searchParams`.** One `await cookies()` there opts every route in the app out of
prerendering, and `getUser()` adds a blocking round-trip to Supabase Auth in front
of the first byte of every page. Per-user chrome belongs in a leaf component behind
`<Suspense>`, rendering a signed-out shell as the fallback. Auth state may be read
optimistically from cookie presence for *display*; anything that gates data still
calls `getUser()`.

**A page that renders a list paginates it.** The catalogue renders what the URL asks
for — `page` is a key in `SEARCH_KEYS` like every other filter, so a paginated result
still survives being pasted into a chat. Rendering 3010 cards produced a multi-megabyte
RSC payload and a document the browser spent seconds laying out. There is no infinite
scroll and no client-side "load more" that forks the filter state.

**`"use client"` is for the interactive leaf, not its container.** `RacketCard` was a
client component because of one `useState` for an image fallback, which shipped 3010
component instances to the browser per catalogue page. Server-render the card, and put
the boundary on the button or the image that actually needs it. `useTranslations` is
not a reason to go client — `getTranslations` does the same job on the server.

**Import icons by name, never the barrel object.** `import { icons } from "lucide-react"`
pulls all ~1500 icons into the client bundle and defeats `optimizePackageImports`,
which can only rewrite named imports. `ds/primitives.tsx` keeps an explicit registry of
the icons the design actually uses; adding an icon means adding a line to it.

**Cache at the data layer, not the page.** `use cache` on the repository's read
functions, with `cacheTag` per table and `cacheLife` matched to how the data actually
changes — the catalogue moves when the scraper runs, not when a user loads a page.
A cached scope may not read cookies or headers; pass what it needs as a serialisable
argument. `scrape:sync` is what invalidates the catalogue, via `revalidateTag`, so a
price change does not wait out a timer.

**Fetch the rows a page needs, not the table.** `loadSnapshot` reads seven tables in
full because the seed fallback has to answer the same questions from memory. That is
the ceiling, not the target — and the catalogue listing no longer pays it: it goes
through `racket_market` with a `.range()`, which is what took that page from ~9.3 s
and 7.4 MB to two bounded round trips. A new read path adds a Postgres query *and*
its seed equivalent behind one repository function, so callers still cannot tell
which source answered. `selectAll` and its unique `.order()` remain mandatory for
anything that does read a whole table (see the 1000-row cap above).

**A derived value that a page sorts or filters by belongs in a column.** Court
Score, lowest price, seller count, balance type and the weight-class set were all
computed in `enrich` and therefore invisible to Postgres, which is why the listing
had to hold the whole catalogue to order it. `racket_market` resolves them; where a
value cannot be expressed in SQL without restating product logic, it is computed in
TypeScript and stored (`racket_scores`), never reimplemented in the migration. The
one constant the SQL does restate — the even-balance band — is guarded by
`assertBalanceBands()`, which throws if `types.ts` and the view disagree.

**Every route that awaits data has a `loading.tsx` or a `<Suspense>` boundary.**
Without one the browser holds the previous page until the server has finished, which
on the catalogue meant seconds of nothing. Skeletons match the real layout's box sizes
so nothing shifts when the content lands.

**A client hook that reads the URL blocks the prerender.** `usePathname`,
`useSearchParams`, `useParams` and `useSelectedLayoutSegment` are runtime data under Cache
Components: reading one anywhere outside a `<Suspense>` boundary blocks the static shell
for every route the component appears on — and for site chrome that is all of them. Put
the boundary around the part that needs the value, not the whole component: the links
stay in the shell where they are crawlable and clickable, and only the active highlight
streams. Where the value is only needed after hydration — a tray that is empty until
localStorage is read — move the call behind that check instead, and no boundary is needed
at all.

**Prerendered page count is capped by the builder, not by taste.** Static generation
retains roughly 15–25 MB per page. Next creates static workers with `isolatedMemory: true`,
which *deletes* `--max-old-space-size` from worker `NODE_OPTIONS` — so `NODE_OPTIONS` only covers
the parent orchestrator/Turbopack process, while static page workers run with default ~2GB V8 heap limits.
**Pages per worker and worker count are the levers that bind**: we configure `experimental.cpus` via `NEXT_BUILD_CPUS=4`
so CI spawns 4 static workers, keeping pages per worker under ~55–65.
Count what a route multiplies: `generateStaticParams` entries times locales. Under Cache
Components an unlisted path still serves an App Shell instantly, so prerendering fewer is
a latency trade, not a missing page.

**`npm run build` passing is not enough for a caching change.** Some Cache Components
validation runs only in development, so a route can build clean and still be blocked from
prerendering. Start `next dev` and open the routes you touched before calling it done.

**Run `npm run build` and read the route table before calling a change done.** A route
that moved from ○ (prerendered) to ƒ (dynamic), or a First Load JS that jumped, is a
regression to explain — not a detail to discover in production.

## Design rules the code enforces

Tokens are in `src/app/globals.css`, ported verbatim from the design system; reach for
the semantic aliases (`--text-primary`, `--signal-verified`), never the raw ramps.
Primitives are in `src/components/ds/`.

- Hairlines separate, shadow floats: a card in a grid gets `1px solid` and no shadow.
- Colour carries meaning, never decoration — green is action, amber is low stock, cyan
  is live data. Status is always colour **and** icon **and** a value.
- Spec labels are eyebrow style in tertiary ink; spec values are mono in primary ink.
- The Balance Ruler (`ds/data.tsx`) plots every racket on the same fixed 280–305 mm
  rule, and in comparison all markers share one rule. There is no radar chart anywhere,
  deliberately.
- Stock: exact count to 10, then `10+`; below 4, "3 left" in amber. Never invent scarcity.
- Prices are never abbreviated — `₫3.290.000`, not `₫3.3M`. Deltas carry a sign, a
  window, and U+2212 for minus.
- Empty states say what to do next, with a number.
- No emoji, no exclamation marks; sentence case except eyebrows.
- Vietnamese runs 20–30% longer than English — never size a control to its English string.

Not built (do not assume these exist): payments, order capture, seller application flow,
admin moderation, review submission, `/vs/[a]-vs-[b]` pages, guide bodies, dark mode.
