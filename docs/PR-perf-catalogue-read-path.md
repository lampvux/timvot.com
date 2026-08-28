# perf: make the catalogue fast enough for Vercel Hobby

Six phases of performance work on the catalogue read path, the payload and the render
strategy. Every phase is a separate commit with its own measurements; the full plan and
the running log live in `docs/performance-plan.md`.

## Why

The catalogue is 3.010 rackets, 3.265 variants, 5.281 offers and a `price_points` table
that grows by ~3.265 rows on every `scrape:refresh`. Nothing was cached, nothing was
paginated, and one `cookies()` call in the locale layout opted every route out of
prerendering. Two of the costs grew on the scraper's schedule rather than on the feature
backlog.

Target is **Vercel Hobby**, whose limits were checked against the docs rather than
recalled. The binding one is **4 CPU-hours a month** — which is what turns finding 01 from
untidy into urgent.

## Measured

| | Before | After |
| --- | --- | --- |
| Enrichment, 3.261 price points (today) | 225 ms | **4 ms** (63×) |
| Enrichment, 293.490 price points (90 scrapes) | 11.249 ms | **78 ms** (145×) |
| Home-page renders inside 4 CPU-hrs | ~640 | **~92.000** |
| Client JS (total chunks) | 1.536 KB | **1.034 KB** (−33%) |
| Prerendered HTML files | 4 | **472** |
| Routes in `prerender-manifest` | 3 | **439** |
| Route entries partial-prerendered (`◐`) | 0 | **42** |
| Route entries dynamic (`ƒ`) | all | **8** |
| Catalogue cards per request | 3.010 | **24** |
| Hero image bytes | ~93 KB | **~8 KB** (−91%) |

The eight remaining dynamic entries are the four that should be, across two locales:
`/account` and `/seller/dashboard` (per-visitor by definition), `/api/revalidate` (a POST
handler) and `/auth/callback` (a one-time code exchange).

## What changed, by commit

1. **`perf(repository)`** — `loadIndex` groups offers, reviews and price points once per
   request instead of scanning each array inside a loop over 3.010 rackets. No public
   signature changed, so the seed fallback and every caller are untouched. Verified
   against a transcription of the old implementation over the seed snapshot: **310 checks,
   0 mismatches.**
2. **`perf(auth)`** — `getUser()` out of the locale layout and the detail page, into leaf
   components behind `<Suspense>`. Every page stops blocking on a Supabase Auth round trip
   before its first byte.
3. **`perf(catalogue)`** — pagination in the URL (`PAGE_SIZE = 24`), `RacketCard` becomes a
   server component, and 26 named icon imports replace `import { icons }` — a barrel object
   holding ~1.500 glyphs that `optimizePackageImports` cannot help with.
4. **`perf(cache)`** — Cache Components enabled, `use cache` + `cacheTag` on the repository,
   an authenticated `/api/revalidate` route, and `scrape:sync` calling it after a clean
   sync so a price change publishes when it is scraped. `generateStaticParams` raised from
   50 to 200 rackets, ordered by Court Score.
5. **`perf(ui)`** — the `searchParams` read moved out of five page bodies into children
   behind `<Suspense>`, with skeletons that match the real components' geometry, plus
   `loading.tsx` for client-side navigation.
6. **`fix(prerender)`** — `usePathname()` in `TopBar`, `MobileTabBar`, `CompareTray` and
   `LanguageSwitcher` was blocking every route's prerender. Fixed at the granularity of the
   value, not the component: links stay in the static shell, only the highlight streams.
7. **`perf(images)` + `feat(images)`** — thumbnails generated at crawl time and served
   `unoptimized`, plus a backfill for images stored before thumbnails existed.

## Operational notes for whoever merges this

- **Apply `supabase/migrations/20260828000000_image_thumbnails.sql` before deploying.**
  It has already been applied to the linked project. If a deployment ever runs ahead of its
  database, `readRackets` retries without the thumbnail columns and logs which migration to
  apply — the degraded state is "no thumbnails", not "no catalogue". That guard exists
  because the first build after adding those columns silently served **18 seeded rackets
  instead of 3.010**: PostgREST rejects the whole query on an unknown column, and the
  repository answers any query error by falling back to the seed.
- **New env vars, optional:** `REVALIDATE_URL` and `REVALIDATE_SECRET`, documented in
  `README.md` rather than `.env.example` (which is gitignored here). Without them the
  scraper says so and carries on.
- **New dependency:** `sharp`, as a devDependency. It was already present as a transitive
  Next dependency, which is not something to rely on.
- **Already run against the linked project:** the migration, and
  `npm run images:thumbs` — 2.188 thumbnails written, 0 failed, `hero_thumb_url` on 414/414
  rackets. State is now 2.264 images with **0 missing a thumbnail**.

## Not done

- **The full gallery crawl.** 2.627 rackets still have no image; a full `scrape:images`
  attempts roughly 1.250 of them and is hours of browser-driven crawling. The crawler
  records rows only after the whole walk, so an interrupted run loses its work — worth
  starting deliberately.
- **Phase 6** (query-shaped reads instead of whole-table reads). It is a memory-footprint
  argument, not a speed one; measure a deployment first.
- **Phase 0's remaining measurements** — real timings against live Supabase, Lighthouse,
  and the Active CPU figure in the dashboard. Everything above is local build output, and
  whether Hobby holds is a question only a deployment answers.

## Fair use, flagged not decided

Vercel Hobby is *"restricted to non-commercial personal use only"*, and the docs list
*"advertising the sale of a product or service"* as an example of commercial usage.
Shuttlecraft lists products with prices, sellers and a seller dashboard. Whether that reads
as commercial is a judgement call and not mine to make — but the consequence is
account-level rather than a slow page, so it is worth deciding deliberately. Nothing in
this PR depends on the answer; every phase helps on Pro too.

## Rules added

`CLAUDE.md` gains a **Performance rules the code enforces** section — eleven rules, each
stating the failure it prevents rather than the practice in the abstract, so a new feature
inherits this work instead of rediscovering it. Two of them were learned the hard way in
this branch: URL-reading client hooks need the boundary around the part that uses the
value, and a green `npm run build` is not sufficient evidence for a caching change, because
some Cache Components validation runs only in `next dev`.

## Verification

`npm run typecheck` and `npm run build` pass. Behaviour checked with throwaway harnesses at
each step: repository equivalence (310 checks), pagination boundaries, revalidate-endpoint
auth (12 cases), thumbnail key derivation and resize, and select-shape equivalence. All
previously-failing routes verified returning 200 in `next dev`.
