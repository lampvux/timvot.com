# Performance plan

Tracking document for the speed work on Shuttlecraft. Rules distilled from this plan
live in `CLAUDE.md` under **Performance rules the code enforces** — that section is the
thing future features must follow. This file tracks *this* body of work.

**Status:** phases 1, 2, 3, 3b, 4 and 5 done. Phase 0 partly done. **One phase remains: 6, and it is optional.**
**Next:** deploy and measure (phase 0's open items). Optional: the full gallery crawl, and phase 6.
**Branch:** `perf/catalogue-read-path`
**Target platform:** Vercel, Hobby (free) plan — verified against the docs, see below.

---

## Scale that makes this necessary

From `supabase/scraped-catalogue.sql` (scraped 2026-08-18):

| Thing | Count |
| --- | --- |
| Rackets | 3.010 |
| Variants | 3.265 |
| Live offers | 5.281 |
| Brands | 36 |
| Price points added **per scrape run** | +3.265 |

The last row is the one that matters. Two of the findings below scale with the price
table, so they get worse on the scraper's schedule rather than on the feature backlog.

---

## Vercel Hobby plan — verified constraints

Checked against `vercel.com/docs/limits`, `/docs/functions/limitations`,
`/docs/image-optimization/limits-and-pricing`, `/docs/limits/fair-use-guidelines`,
`/docs/cron-jobs/usage-and-pricing` and `/docs/incremental-static-regeneration`
on 2026-08-28.

| Limit | Hobby | Why it matters here |
| --- | --- | --- |
| **Active CPU** | **4 CPU-hrs / month** | The binding budget. The O(n×m) enrichment burns this directly. |
| **Function memory** | **2 GB / 1 vCPU** (max, not just default) | The whole snapshot must fit, and there is no second core to spread work across. |
| Function max duration | 300s (default and max) | Not a constraint for us. |
| **Image transformations** | **5K / month** | We have 3.010 hero images. See the revision to phase 3. |
| Image cache reads / writes | 300K / 100K per month | Fine. |
| **Fast Data Transfer** | **100 GB / month** | The unpaginated 3.010-card page spends this fast. |
| **Fast Origin Transfer** | **10 GB / month** | Function → CDN. Prerendering reduces it directly. |
| Function invocations | 1M / month | Fine, once pages are prerendered. |
| Build time | 45 min per deployment | Caps how many detail pages we prerender at build. |
| Concurrent builds | 1 | Deploys queue. Fine. |
| Deployments | 100 / day | Fine. |
| **Cron jobs** | **once per day, ±59 min** | Rules out scheduled revalidation at any useful cadence. |
| Git repos | **Personal repos only** — no Git-org-owned repos on Hobby | Check where this repo lives before linking the project. |

### Two things that change the plan

**1. `use cache` is in-memory only.** Per `use-cache-remote.md` in the bundled Next docs,
plain `use cache` stores entries in the instance's memory: evicted under pressure, not
shared across instances, gone on restart. `'use cache: remote'` gives durable shared
caching but needs a platform cache handler and "typically incurs platform fees".

So on Hobby the free durable cache layer is **ISR / prerender output**, not the data
cache. The mechanism that saves Active CPU is stated plainly in the ISR docs: on a CDN
hit, *"your function doesn't run."* Phase 4 is therefore reframed — `use cache` is what
makes a route's shell prerenderable, and prerendering is what makes it free. Do not
reach for `'use cache: remote'` on this plan.

**2. Image optimization will break before it gets expensive.** 5K transformations/month
against 3.010 rackets, where each distinct `(src, width, quality)` is its own
transformation. Two widths per racket already exceeds the allowance. On exceeding it
Hobby returns **HTTP 402** and `next/image` renders the `alt` text — a visible product
failure, not a slow page. Phase 3's image section is rewritten accordingly.

### Fair use — flagging honestly

Hobby is *"restricted to non-commercial personal use only"*, and the docs list
**"advertising the sale of a product or service"** as an example of commercial usage.
Shuttlecraft lists products with prices, sellers and a seller dashboard. Whether that
reads as commercial is a judgement call and it is yours to make, not mine — but it is
worth deciding deliberately before the project is linked, because the consequence is
account-level, not a slow page. Nothing in this plan depends on the answer; every phase
below helps on Pro too, and phases 1–3 help most on Hobby precisely because Hobby has no
overage to buy.

---

## Findings, ranked

| # | Finding | Where | Cost per request | Phase |
| --- | --- | --- | --- | --- |
| 01 | Enrichment scans the price table once per racket | `repository.ts` → `enrich()` | ~10M steps now, ~880M at 90 days of scrapes | 1 ✅ |
| 02 | `getDeals` re-filters and re-sorts history per variant | `repository.ts` → `getDeals()` | 3.265 scans + 3.265 sorts | 1 ✅ |
| 03 | Catalogue renders every match, no pagination | `rackets/page.tsx` | 3.010 cards in one RSC payload | 3 ✅ |
| 04 | `getUser()` in the locale layout reads cookies | `[locale]/layout.tsx` | every route dynamic + blocking auth call | 2 ✅ + 4 ✅ |
| 05 | Whole lucide icon set ships to the browser | `ds/primitives.tsx` | ~1.500 icons bundled, 26 used | 3 ✅ |
| 06 | No cache anywhere | — | full snapshot per request | 4 ✅ |
| 07 | `RacketCard` is a client component for one `useState` | `racket-card.tsx` | 3.010 client instances hydrated | 3 ✅ |
| 08 | Snapshot pulls every `racket_images` row, all columns | `mappers.ts` → `RACKET_SELECT` | checksum, bytes, width, height per image | 6 |
| 09 | No Suspense or `loading.tsx` on any route | `app/**` | browser holds the old page until done | 5 ✅ |
| 10 | `compress: false` disables gzip on the Node server | `next.config.ts` | uncompressed HTML off Vercel | 5 ✅ |

---

## Phases

### Phase 0 — Baseline · ◐ partly done

- [x] **Build route table captured** (`npm run build`, 2026-08-28, before phase 2).

      Every route is **ƒ (Dynamic)**. The only static entry in the whole app is
      `/_not-found`:

      ```
      ○ /_not-found
      ƒ /[locale]                          ƒ /[locale]/rackets
      ƒ /[locale]/account                  ƒ /[locale]/rackets/[brand]/[model]
      ƒ /[locale]/compare                  ƒ /[locale]/sellers
      ƒ /[locale]/deals                    ƒ /[locale]/sellers/[slug]
      ƒ /[locale]/finder                   ƒ /[locale]/methodology
      ƒ /[locale]/guides                   … (all ƒ)
      ```

      Worse: the build spends **68s generating 140 pages** from
      `generateStaticParams` and then serves every one of them dynamically. No HTML
      is emitted for any locale route — `.next/server/app/vi/` holds only
      subdirectories, and `prerender-manifest.json` lists three routes, none of them
      a page. That is 68 seconds of build time producing nothing.

      The cause is **two** things, not one: the `cookies()` read in the locale layout
      *and* the uncached Supabase reads on every data page. Phase 2 removes the first
      from the critical path; phase 4 has to cache the second before the table moves.
      See the correction under phase 2.

- [ ] Time `loadSnapshot`, `getRackets`, `getDeals` against a real Supabase snapshot.
- [ ] Record actual row counts in the linked project, especially `price_points`.
- [ ] Lighthouse (mobile throttling) on home, `/rackets`, one detail page.
- [ ] On Hobby, also watch the **Active CPU** figure in the dashboard — that is the
      number the free plan actually rations.

---

### Phase 1 — Index the snapshot · ✅ done

Build lookups once per snapshot instead of scanning arrays inside a per-racket loop.
One file, no framework change, no public signature changed — so the seed fallback and
every caller are untouched.

- [x] `loadIndex()` — cached per request like `loadSnapshot`, and the single place the
      lookups are built: `offersByRacket`, `offersBySeller`, `reviewsByRacket`,
      `historyByVariant` (sorted once, here), `liveOfferCountByVariant`, `sellersById`,
      `variantsById`, plus the enriched list and its `enrichedByPath` /
      `enrichedBySlug` maps.
- [x] `enrich()` reads the indexes — three full-array filters removed.
- [x] `getVariantPrice` reads `historyByVariant` and no longer sorts (the index is
      sorted once, at build time, not 3.265 times).
- [x] `getDeals` walks the index instead of awaiting `getVariantPrice` per variant in a
      nested loop.
- [x] `getHeadlineVariantPrice` reads `offerCountByVariant` instead of re-walking every
      offer per racket.
- [x] `getOffersForRacket` / `getOffersForSeller` read the offer indexes.
- [x] `getRacket` is a map lookup keyed `brandSlug/slug`, not a linear `find` over 3.010
      enriched rackets.
- [x] `getRacketsBySlugs` is a map lookup, preserving the user's chosen order.
- [x] `npm run typecheck` passes.
- [x] **Equivalence checked, not assumed.** A throwaway harness ran the new repository
      against the seed snapshot and compared every derived value with a literal
      transcription of the old scanning implementation — `courtScore`, `specScore`,
      `lowestPrice`, `sellerCount`, `reviewCount`, `balanceType`, the history set and
      its ordering, plus `getRacket`, `getVariantPrice`, `getHeadlineVariantPrice`,
      `getOffersForRacket`, `getOffersForSeller`, `getReviewsForRacket`, `getDeals`
      and slug-order preservation in `getRacketsBySlugs`.
      **310 checks, 0 mismatches.**

**Result — measured, at real catalogue scale** (3.010 rackets, 3.261 variants):

| Price table | Old (scan per racket) | New (index once) | |
| --- | --- | --- | --- |
| 3.261 points — today, one scrape | 225 ms | 4 ms | **63×** |
| 293.490 points — 90 daily scrapes | 11.249 ms | 78 ms | **145×** |

The second row is the point. The old cost grew with the price table; the new one does
not meaningfully. And on the Hobby budget of 4 CPU-hours, where a home-page render
walks this path twice (`getRackets` + `getDeals`):

- at the old 90-day cost: **~640 home-page renders per month** before the free plan's
  Active CPU is gone
- at the new cost: **~92.000**

That is what makes this a quota-survival fix and not only a speed fix.

---

### Phase 2 — Static shell · ✅ done (structurally) — see the correction below

`[locale]/layout.tsx` awaited `getUser()`, which reads `cookies()`, putting a Supabase
Auth round-trip in front of the first byte of every page. **Blocks phase 4** — a
`use cache` scope cannot read cookies, so while the layout did, the repository was
uncacheable through it.

- [x] `TopBar` takes an `accountSlot: ReactNode` instead of `signedIn: boolean`. The
      layout now awaits nothing at all.
- [x] `src/components/auth-slot.tsx` — `<AccountSlot />` owns the `getUser()` read behind
      `<Suspense>`, with the signed-out link as the fallback. Both states render identical
      markup, so the 44px target never moves.
- [x] `src/components/watch-price-slot.tsx` — same treatment for the racket detail page,
      which awaited `getUser()` in the same `Promise.all` as the catalogue read. A spec
      sheet no longer waits on auth.
- [x] Security boundary written into both components: what resolves there decides which
      link to paint and nothing else. `WatchPriceButton` already re-establishes the user
      with `supabase.auth.getUser()` before upserting, and the `watchlist` RLS policy is
      the real gate.
- [x] `npm run typecheck` and `npm run build` pass.

#### Correction — phase 2 does not flip the route table on its own

I said this phase would recover the 68s of wasted build time and turn routes static. That
was wrong, and the build says so: **the route table is unchanged, still all `ƒ`.**

Two things were mixed up:

1. **A `<Suspense>` boundary buys nothing without PPR.** Partial prerendering is what lets
   a static shell ship while a `cookies()` branch streams. Without `cacheComponents: true`
   there is no PPR, so a `cookies()` read *anywhere* in the tree — inside a boundary or
   not — still makes the whole route dynamic.

2. **`force-static` on the home page "worked", misleadingly.** It prerendered without
   error only because `createClient()` catches the `cookies()` throw and falls back to
   `createStaticClient()`. The page silently rendered signed-out. That fallback is
   deliberate and correct for `generateStaticParams`, but it means force-static is not a
   valid test of whether a route is prerenderable.

Enabling `cacheComponents: true` as an experiment made Next name the real blocker:

```
Error: Route "/[locale]/rackets/[brand]/[model]": Next.js encountered uncached
or runtime data during prerendering.

`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or
`connection()` accessed outside of `<Suspense>` prevents the route from being
prerendered […]
  - [cache] For uncached data (fetch, database calls): cache the access with "use cache"
```

So the uncached Supabase reads block prerendering too, not only the auth call — and Next's
own prescription is the `"use cache"` on the repository that phase 4 already plans.

**The dependency is mutual, not one-way.** Phase 2's structure is required for phase 4
(cookies cannot live in a cached scope). Phase 4's flag is required for phase 2 to show up
in the route table. Neither pays off alone; the flip happens when both are in.

**What phase 2 is worth on its own:** every page render stops blocking on a Supabase Auth
round-trip before its first byte. That is a real latency win today, on a dynamic route,
and it is the precondition for the bigger one.

---

### Phase 3 — Payload · ✅ done (app side; one scraper item carried to phase 3b)

- [x] **Paginated, in the URL.** `page` added to `SEARCH_KEYS`, `PAGE_SIZE = 24` (divides
      evenly by the grid's 1, 2 and 3 columns, so no page ends on a ragged row).
      `src/components/pagination.tsx` renders prev/next as real `<Link>`s carrying the
      current filters — server-rendered, so paging ships no JavaScript.
      **`page` is deliberately not part of `CatalogFilters`:** `applyFilters` and
      `facetCounts` must see the whole result set or the counts are wrong, and keeping it
      out means `filtersToQuery` drops it for free, so changing any facet resets to page 1
      without a line of code saying so. Logic tested: page-count boundaries, `parsePage`
      against junk input, and that every item lands on exactly one page across totals from
      0 to 3.010.
- [x] **`RacketCard` is a server component.** `useTranslations` → `getTranslations`, and
      the failed-image `useState` is gone: the brand-name placeholder sits *underneath*
      the image, which now carries `alt=""` because the heading below is the accessible
      name — so a broken load collapses silently and reveals the placeholder with no JS.
      Only `CompareToggle` still crosses the boundary.
- [x] **Icon registry.** `import { icons } from "lucide-react"` replaced with 26 named
      imports. `IconName` is now `keyof typeof ICONS`, a closed union — which is also how
      the list was verified: the compiler enumerates any name the registry misses. My
      first count of 17 was wrong; it came from a grep that missed ternary usages
      (`BellRing`, `Check`, `TrendingUp`, `TrendingDown`, `Search`) and picked up five
      brand names that are not icons at all.
- [x] **Image config trimmed.** `imageSizes: [96, 256, 384]`, `deviceSizes: [640, 828,
      1080, 1200]` — seven widths instead of the default sixteen. `minimumCacheTTL` raised
      to 31 days. The card's mobile `sizes` was `100vw` for a box that is 96px wide, which
      was requesting a full-width transformation per card.
- [x] `npm run typecheck` and `npm run build` pass.

**Result — measured.** Total client chunks, built both ways:

| | Client JS |
| --- | --- |
| Before (barrel icons, client card) | 1.536 KB |
| After | **1.034 KB** |

**502 KB less, a third of the bundle**, before counting the RSC payload saved by rendering
24 cards instead of 3.010 — which is the larger win on the 100 GB transfer allowance and
does not show up in this number.

Also fixed in passing: the mobile card line had a mojibake `Â·` where a `·` belonged.

---

### Phase 3b — Image thumbnails in the scraper · ✅ done

Phase 3 reduced the *widths* per image; this reduces the *count*, which is what the
5K/month cap actually rations.

- [x] `scripts/scraper/images/thumbnail.ts` — `makeThumbnail` produces a ~400px webp with
      `sharp`, from bytes the crawler already downloaded. Never upscales, and returns
      `null` rather than throwing when sharp cannot decode a frame or the result would not
      be smaller than the source. A thumbnail is an optimisation; losing the full-size
      image we just fetched because the derived one failed is not a trade worth making.
- [x] `storage.ts` stores it at `<same-key>-thumb.webp`, in the same brand subtree — so a
      takedown is still one prefix delete rather than two lists to reconcile. A failed
      thumbnail upload warns and returns `thumbUrl: null`; it does not fail the put.
- [x] Migration `20260828000000_image_thumbnails.sql` adds `racket_images.thumb_path` /
      `thumb_url` and `rackets.hero_thumb_url`, all nullable and read as `thumb ?? original`
      so a racket crawled before this keeps working and a re-crawl fills it in. No backfill
      step to forget.
- [x] `types.ts`, `mappers.ts`, `seed.ts` and `generate-seed.ts` carry the new fields —
      the schema change touches all four, as `CLAUDE.md` says it must. `supabase/seed.sql`
      regenerated rather than hand-edited.
- [x] `RacketCard` serves `heroThumbUrl` with `unoptimized`, falling back to
      `heroImageUrl` through the optimizer when no thumbnail was crawled.
- [x] `sharp` declared as a devDependency. It was already present as a transitive Next
      dependency, which is not something to rely on.
- [x] Tested: key derivation across five path shapes, resize/aspect/format, the
      no-upscale rule, and null on garbage and empty input.

#### The deployment hazard this surfaced, and the guard for it

Adding columns to `RACKET_SELECT` broke the build before anything else did. PostgREST
rejects the whole query when it names a column the schema lacks, and `readSnapshot`
answers *any* query error by falling back to the seeded catalogue. So the first build
after this change produced **113 pages in 4.6s instead of 475 in 2.2min** — eighteen
seeded rackets standing in for three thousand, with no error anywhere.

That is the same class of failure as the 1000-row cap: correct-looking output, silently
wrong data. So `readRackets` now retries once with `RACKET_SELECT_NO_THUMBS` when the
error says a column is missing, and logs what to do about it:

```
[repository] rackets: thumbnail columns are missing, so the catalogue is being
read without them. Apply supabase/migrations/20260828000000_image_thumbnails.sql
and redeploy.
```

Verified against the un-migrated database: **475 pages again**, warning logged, catalogue
intact. The degraded state is "no thumbnails", not "no catalogue".

Both select shapes are checked to name identical columns apart from the thumbnail ones, so
the fallback cannot silently drop a field.

#### Applied and run — 2026-08-28

- [x] Migration applied via `npm run migrate` (`DIRECT_URL`). Columns verified present.
- [x] **`scripts/scraper/images/backfill-thumbnails.ts` written and run.** This was a gap
      in the phase as first shipped: `scrape:images` writes a thumbnail only for images it
      stores *now*, and it skips rackets that already have a gallery — that skip is what
      makes the crawler re-runnable. So the 2.194 images crawled before thumbnails existed
      would never have got one. `--refresh` would fix it by re-crawling every manufacturer
      site; the backfill reads the bytes out of our own bucket instead, contacting nobody.
      **2.188 thumbnails written, 0 failed**, plus 6 in a verification batch.
- [x] `scrape:images` run (bounded, `--limit=25`) to exercise the crawler's own thumbnail
      path: 14 rackets stored, 70 images, **14/14 with a thumbnail**.

**State now:** 2.264 images, **0 without a thumbnail**; 429 of 3.056 rackets have a hero
and all 429 have a hero thumbnail. Measured on four heroes: ~93 KB → 8 KB, about 91%
smaller. The live catalogue serves 14 thumbnails on page one with **zero `/_next/image`
calls**; the 126 prerendered `/_next/image` references left are the detail-page gallery,
which is where the optimizer is meant to stay.

**Not done — the full gallery crawl.** 2.627 rackets still have no image at all. A full
`scrape:images` attempts roughly 1.250 of them (the rest are brands with no manufacturer
site in `providers.ts` — li-ning, fleet, vs, proace, kawasaki, flypower, adidas).
That is hours of browser-driven external crawling, and the crawler records rows only after
the whole walk, so an interrupted run loses its work. Worth running deliberately, not as a
step inside another task.

### Phase 4 — Cache Components · ✅ done

The phase that finally moved the route table. `use cache` makes a route's shell
**prerenderable**; prerendering is what makes it free — a CDN hit does not invoke the
function, which is the only thing that protects 4 CPU-hours a month.

- [x] `cacheComponents: true` in `next.config.ts`, with `cacheLife` profiles matched to
      the scrape cadence rather than to page loads: `catalogue` (6h revalidate) for specs
      and names, `prices` (15m) for what people reload for.
- [x] `"use cache"` + `cacheLife("catalogue")` + `cacheTag(...)` on the repository's
      `readSnapshot`. `loadSnapshot` stays wrapped in React `cache` on top, so one render
      hits the cross-request cache once rather than per caller.
- [x] `src/lib/data/tags.ts` — tag names in one place. They are a contract between a node
      script and a deployed route, so a typo on either side would fail silently as a price
      that never appears. `isCacheTag` makes the route reject unknown tags with a 400
      rather than reporting success having revalidated nothing.
- [x] `src/app/api/revalidate/route.ts` — POST, bearer secret compared in constant time,
      `revalidateTag(tag, "max")` for stale-while-revalidate. Refuses when no secret is
      configured rather than being an open cache-eviction endpoint. Auth logic tested
      against twelve cases (no secret, empty secret, prefix, suffix, wrong case, missing
      header).
- [x] `scripts/scraper/revalidate.ts`, called from `--sync-db` **only when the sync
      reported clean** — revalidating after a partial write would publish a half-updated
      catalogue instead of holding the last good one. Never fails the run: a cache that
      refreshes on its timer is a slower update, not a wrong one.
- [x] `REVALIDATE_URL` / `REVALIDATE_SECRET` documented in `.env.example`; with neither
      set the scraper says so and carries on, which is the local-database case.
- [x] `generateStaticParams` raised from 50 to **200 rackets, ordered by Court Score**
      instead of scraper order — a racket people have reviewed is a better proxy for one
      people will open. The tail is not left behind: under Cache Components an unlisted
      path serves an App Shell instantly and upgrades in the background.
- [x] Did **not** use `use cache: remote`.

**Result — measured.**

| | Before phase 4 | After |
| --- | --- | --- |
| Prerendered HTML files | 4 | **472** |
| Routes in `prerender-manifest` | 3 | **439** |
| Route entries partial-prerendered (`◐`) | 0 | **27** |
| Route entries dynamic (`ƒ`) | all | 23 |
| Build time | 55s (163 pages) | 119s (475 pages) |

Build time is the cost, and it is affordable: 119s locally against a 45-minute cap, with
room to raise `PRERENDERED_RACKETS` later if the Active CPU figure justifies it.

#### Two things the migration guide changed

1. **`revalidateTag` now takes a cache profile as a second argument.** `revalidateTag(tag)`
   is a type error under Cache Components; `revalidateTag(tag, "max")` is stale-while-
   revalidate. `updateTag` is the read-your-own-writes alternative but only works in a
   Server Action, and the caller here is a node script.
2. **Route segment config `dynamic` is incompatible with `cacheComponents`** and fails the
   build outright. The revalidate route's `export const dynamic = "force-dynamic"` had to
   go; a route handler that reads a request body is dynamic anyway.

#### Debt this phase created — seven routes opted out

`instant = false` is set on `/account`, `/seller/dashboard`, `/compare`, `/finder`,
`/rackets`, and the four auth pages. That marks a segment *allowed to block*; it does not
force it dynamic, which is why `/forgot-password` and `/reset-password` still prerender.

Two of those are honest and permanent — `/account` and `/seller/dashboard` are per-visitor
by definition and have no shell worth shipping. The rest are **phase 5 work**: they read
`searchParams` at the top of the component, and the fix is to move that read into a child
behind `<Suspense>` so the rest of the route prerenders.

`/rackets` is the one that matters. It is the most-visited page after the home page, it is
still fully dynamic, and it is the page phase 5's catalogue split was already scoped to fix.

### Phase 5 — Make the wait legible · ✅ done

#### Follow-up: `usePathname()` in the chrome blocked every prerender

Enabling Cache Components in phase 4 made three client components in the locale layout
block the prerender of every route, and the production build did not say so — only
`next dev` did:

```
Route "/[locale]/rackets/[brand]/[model]": Next.js encountered URL data
`usePathname()` in a Client Component outside of <Suspense>.
```

`usePathname()` is URL data. Under Cache Components, reading it anywhere in the tree
outside a boundary blocks the shell — and this chrome is on every page. Fixed at the
right granularity rather than by wrapping whole components, because the links themselves
belong in the static shell: they are navigation, and they have to work and be crawlable
from the first byte.

- **`TopBar` / `MobileTabBar`** — the links render in the shell; only the *highlight*
  streams. `isActive(null, …)` is `false`, so the fallback shows the same markup with
  nothing marked active and the settle is one underline appearing, not a layout shift.
- **`CompareTray`** — no boundary needed. The tray is empty until the provider reads
  localStorage, so it returns `null` during prerender; moving the pathname read into a
  `TrayBody` child behind that check means the prerender never reaches it. By the time a
  tray exists the browser is already running.
- **`LanguageSwitcher`** — found by audit, not by the error, and it would have surfaced
  next. Its *appearance* is now in the shell and only its *behaviour* streams: the label
  comes from `useLocale()` (provider context, not URL), so the fallback already shows the
  right language and nothing changes visually. The button is disabled until the pathname
  arrives — not yet interactive rather than interactive-but-broken, since without a
  pathname there is nowhere to switch to.

Verified in `next dev`, which is where it appeared: all seven previously-failing routes
return 200 with no `CLIENT_HOOK_DYNAMIC` and no error lines, and the served HTML still
carries the active underline and `aria-current="page"`. Build still 475 pages.

**Lesson worth keeping:** `npm run build` passing is not sufficient evidence for a Cache
Components migration. Some validation runs only in development, so a route can build
clean and still be blocked from prerendering. Run `next dev` and open the routes.


Phase 4 handed this phase a concrete worklist rather than a general intention, and it is
now empty: **every `instant = false` that was debt has been removed.**

- [x] **`/rackets`** — the page body moved into `<CatalogResults>` behind `<Suspense>`,
      with the `searchParams` promise passed down instead of awaited at the top. That await
      was what blocked the prerender for the whole route.
- [x] **`/compare`**, **`/finder`** — same split.
- [x] **`/sign-in`**, **`/sign-up`** — same split; only the callback error or notice is
      per-request, so only that streams.
- [x] **`/forgot-password`, `/reset-password`** — opt-out removed outright. They never read
      `searchParams`; the blanket comment I put on all four auth pages in phase 4 was wrong
      for these two.
- [x] `src/components/skeletons.tsx` — every box matches the real component's geometry: the
      rail is `--filter-rail-w`, the card image is the same `1.15/1` aspect, the grid has
      the same three breakpoints. `bg-sunken` rather than a shimmer, because the design
      system has no animated placeholder and motion there would be decoration.
- [x] `loading.tsx` for catalogue, compare, finder and the racket detail page. These cover
      client-side navigation, where the in-page Suspense boundary does not apply — same
      skeleton either way, so both paths look identical to a visitor.
- [x] `compress: false` kept, now with a comment saying it is a hosting assumption rather
      than a preference: Vercel's edge compresses, and this ships uncompressed HTML from
      `next start` anywhere else.

**Result — measured.**

| | After phase 4 | After phase 5 |
| --- | --- | --- |
| Route entries partial-prerendered (`◐`) | 27 | **42** |
| Route entries dynamic (`ƒ`) | 23 | **8** |
| Routes carrying `instant = false` | 7 | **2** |

The eight remaining dynamic entries are the four that should be, across locales:
`/account` and `/seller/dashboard` (per-visitor by definition), `/api/revalidate` (a POST
handler) and `/auth/callback` (a one-time code exchange). Nothing left on the list is debt.

#### Two items dropped, with reasons

- **`useTransition` in `FilterRail`** — already there. `useFilterBody` wraps its
  `router.replace` in a transition and dims with `pending && "opacity-70"`. Nothing to do.
- **Streaming the detail page's offers, reviews and history below the fold** — dropped,
  because it would buy nothing. All three come from `loadIndex()`, which resolves from the
  one `use cache`d snapshot, so there is no independent slow dependency to stream past.
  Splitting them would add boundaries without removing a wait. The plan assumed they were
  separate reads; phase 1's indexing is what made them not be.

### Phase 6 — Read rows, not tables · ☐ open, defer if 1–5 land the numbers

On Hobby this is also a **memory** argument: the max is 2 GB and the snapshot holds
every racket with every variant and every `racket_images` row.

- [ ] Trim `RACKET_SELECT` first — a one-line change. Cards need `hero_image_url`; only
      the gallery needs image rows, and it needs four of their fourteen columns.
- [ ] Task-shaped reads — `getCatalogPage(filters, page)`, `getRacketDetail(brand, model)`
      — each with a Supabase branch and a seed branch behind one signature, so callers
      still cannot tell which source answered.
- [ ] Push filtering into Postgres. `rackets_brand_idx`, `rackets_balance_idx`,
      `rackets_flex_idx` and the search index already exist and go unused.
- [ ] Facet counts as a materialised view or RPC refreshed by the scraper.
- [ ] Court Score as a generated column or a scraper-time computation.
- [ ] Keep `selectAll` and its unique `.order()` for anything that still reads a whole
      table. The 1000-row cap is silent and already cost this repo every detail page past
      the first thousand.

---

## Vercel build OOM — 2026-08-28

The first production build on `main` failed:

```
Build machine configuration: 2 cores, 8 GB
Generating static pages using 1 worker (53/475)
FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory
```

### What it is not

**Not the cached snapshot.** Measured against the live project: the whole catalogue is
**37 MB** of heap — 3.056 rackets carrying 2.264 image rows (4 MB serialized), 2.958
offers, 6.519 price points. Nowhere near 1.8 GB. Phase 6's memory argument is real, but
it is not this.

**Not something more heap fixes.** `NODE_OPTIONS=--max-old-space-size=6144`, on a machine
with 8 GB, crashed at *the same page count* as the default 1.85 GB — the setting does not
reach the static-generation worker. Do not reach for it.

**Not a WeakMap away.** Memoising the index on the snapshot object was tried and reverted:
`use cache` hands back a fresh snapshot per render, so the memo never hit. Reverted rather
than left in place, because code carrying a comment that claims a benefit it does not
deliver is worse than no code.

### What it is

Static generation accumulates memory per page and does not give it back, and **Hobby runs
it in one worker** — the build log says so plainly. Reproduced locally with
`experimental.cpus: 1`: the same crash, ~146 pages in. Locally with fifteen workers the
same 475 pages build fine, each worker taking a thirtieth of them.

That is the entire difference between the passing local build and the failing Vercel one,
and it is why a green local build was not evidence. The same lesson as the `usePathname`
follow-up, in a new costume.

The ceiling is roughly **145 pages per worker**. Measured: 111 pages ✓, 131 ✓, 475 ✗.

### Fix applied

`PRERENDERED_RACKETS` 200 → **30**, giving `2 × 30 + ~75 = 135` pages. Nothing is lost
from the catalogue: under Cache Components a path not listed still serves an App Shell
instantly and upgrades in the background, so the tail is a slightly later page rather than
a missing one.

### Still unexplained, and worth chasing

**Roughly 12 MB retained per prerendered page**, against a catalogue that measures 37 MB in
total. That number is not accounted for, and until it is, page count is the only lever.
Raising the prerender count needs either more workers or an explanation for that 12 MB.

### `--max-old-space-size` cannot raise the static-generation heap

Worth writing down, because it looks like it should work and quietly does not.

Next creates the static-generation worker in `node_modules/next/dist/build/index.js`:

```js
// remove --max-old-space-size flag as it can cause memory issues.
isolatedMemory: true,
```

and `lib/worker.js` acts on that:

```js
if (isolatedMemory) {
  delete nodeOptions['max-old-space-size'];
  delete nodeOptions['max_old_space_size'];
}
```

It is hardcoded, with no config option. Confirmed by probing from inside a page render
during a build: with `NODE_OPTIONS=--max-old-space-size=8192` on the parent, the worker
reports `NODE_OPTIONS=--enable-source-maps` and a limit of **4144 MB** — the machine
default. The flag is not ignored, it is deleted.

**The one way to make it apply** is `experimental.workerThreads: true`, which turns the
workers into threads sharing the parent's V8 settings. Probed: the worker then reports
**7216 MB** under `--max-old-space-size=7168`. But it does not solve the problem — 475
pages in a single worker still died at 7 GB, because the per-page cost is ~15 MB and
475 × 15 MB ≈ 7 GB. Raising the ceiling buys a little room, not a different shape.

**Pages per worker is the lever that binds.** Measured, at default heap:

| Workers | Pages | Result |
| --- | --- | --- |
| 1 | 475 | crash, ~146 in |
| 1 | 131 | builds |
| 4 | 475 | builds, 3.4 min |
| 15 | 475 | builds, 2.2 min |

Four workers carry 475 pages at 119 each — comfortably under the ~145 ceiling. That is
why the CI workflow works at 200 rackets where Hobby's single worker cannot, and it is
why the workflow clamps the request to `(145 × cores − 75) / 2` rather than trusting the
input.

### On building in CI instead

Building in GitHub Actions and deploying with `vercel deploy --prebuilt` would work: more
cores means more workers means fewer pages each. It treats the symptom rather than the
cause and costs a pipeline to maintain, so it is worth it only to prerender substantially
more than 30 rackets before the per-page cost is understood. Larger Vercel build machines
are Pro and Enterprise only, so that route is not available on this plan.

---

## Open decisions

| Decision | Notes |
| --- | --- |
| Hobby vs Pro | Fair-use commercial definition, and whether 4 CPU-hrs / 5K image transformations are enough. Phases 1–3 help most on Hobby, since Hobby has no overage to buy. |
| Scrape cadence | Sets every `cacheLife` window in phase 4, and how fast `price_points` grows. |
| Catalogue page size | 24 or 36. A grid decision, not a performance one — both fix the payload. |
| Client-side search | The query filter is a JS `includes()`. Postgres has a search index on `rackets` going unused. |
| Whether phase 6 happens | Measure after 5. If green, it is a memory-footprint argument, not a speed one. |
