# Performance plan

Tracking document for the speed work on Shuttlecraft. Rules distilled from this plan
live in `CLAUDE.md` under **Performance rules the code enforces** — that section is the
thing future features must follow. This file tracks *this* body of work.

**Status:** phases 1, 2 and 3 done. Phase 0 partly done. Phases 3b, 4, 5, 6 open.
**Next:** phase 4 — the route table stays all-`ƒ` until `use cache` lands. See the correction under phase 2.
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
| 04 | `getUser()` in the locale layout reads cookies | `[locale]/layout.tsx` | every route dynamic + blocking auth call | 2 ✅ (flip needs 4) |
| 05 | Whole lucide icon set ships to the browser | `ds/primitives.tsx` | ~1.500 icons bundled, 26 used | 3 ✅ |
| 06 | No cache anywhere | — | full snapshot per request | 4 |
| 07 | `RacketCard` is a client component for one `useState` | `racket-card.tsx` | 3.010 client instances hydrated | 3 ✅ |
| 08 | Snapshot pulls every `racket_images` row, all columns | `mappers.ts` → `RACKET_SELECT` | checksum, bytes, width, height per image | 6 |
| 09 | No Suspense or `loading.tsx` on any route | `app/**` | browser holds the old page until done | 5 |
| 10 | `compress: false` disables gzip on the Node server | `next.config.ts` | uncompressed HTML off Vercel | 5 |

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

### Phase 3b — Image thumbnails in the scraper · ☐ open

Split out of phase 3 because it spans `scripts/scraper/`, not the app. Phase 3 reduced the
*widths* per image; this reduces the *count*, which is what the 5K/month cap actually
rations.

- [ ] Have `scripts/scraper/images/` write a ~400px webp thumbnail alongside the original
      when it stores to the `racket-images%` bucket. It already downloads every file, so
      the resize happens once, in a script we already run.
- [ ] Serve that thumbnail from `RacketCard` with `unoptimized`, taking the catalogue grid
      off the metered optimizer entirely.
- [ ] Keep `next/image` optimization for the detail-page gallery only, which caps
      transformations at roughly the number of detail pages actually visited.

**Do not do the second step without the first.** Setting `unoptimized` on the current
full-size originals would trade a transformation problem for a Fast Data Transfer problem,
and Hobby only allows 100 GB of that.

#### Images — revised for Hobby

The original plan (trim `deviceSizes`, raise `minimumCacheTTL`) is not enough against a
5K/month transformation cap and 3.010 hero images.

- [ ] **Do not run catalogue thumbnails through `next/image` optimization.**
      `scripts/scraper/images/` already downloads each image and writes it to a
      `racket-images%` Supabase bucket. Have it also write a pre-sized thumbnail
      (~400px webp) at that point, and serve it with `unoptimized`. The resize happens
      once, in a script we already run, instead of 3.010 times against a metered API.
- [ ] Reserve `next/image` optimization for the detail-page gallery, which caps
      transformations at roughly the number of detail pages actually visited.
- [ ] Trim `images.deviceSizes` / `imageSizes` to the widths the gallery genuinely
      requests, and raise `minimumCacheTTL` — transformations are billed per cache MISS
      and STALE, so a long TTL directly reduces the count.
- [ ] Keep `priority` on the gallery hero only. Never on cards.

---

### Phase 4 — Cache Components, reframed for Hobby · ☐ open

Enable the flag and mark the read path, but understand what it buys on this plan:
`use cache` makes a route's shell **prerenderable**; prerendering is what makes it free.

- [ ] `cacheComponents: true` in `next.config.ts` (this also makes PPR the App Router
      default, which is what makes phase 2's static shell pay off). **This is the phase
      that moves the route table** — phase 2 alone does not, see its correction.
      Flipping the flag on its own fails the build with
      `Route "/[locale]/rackets/[brand]/[model]": Next.js encountered uncached or
      runtime data during prerendering`, so the flag and the `use cache` marks below
      have to land together.
- [ ] `cacheLife` profiles matched to the scrape cadence, not to page loads.
- [ ] `"use cache"` + `cacheTag("rackets", "offers", "price-points", "reviews")` on the
      repository reads.
- [ ] **Prerender the detail pages.** `generateStaticParams` currently returns 50 of
      3.010 and none of them prerender because the layout is dynamic. After phase 2 they
      prerender for real. Return the top few hundred by Court Score and let ISR fill in
      the rest on demand — the ISR docs recommend exactly this to keep builds inside the
      45-minute cap, and 3.010 × 2 locales is 6.020 pages.
- [ ] **On-demand revalidation from the writer.** `scrape:sync` calls `revalidateTag`
      through a small authenticated route after a successful sync, so a price change
      appears when it is scraped. Hobby crons are once-per-day with ±59 min precision, so
      on-demand is the mechanism and `cacheLife` is only the safety net.
- [ ] **Do not use `'use cache: remote'`.** It needs a platform cache handler and incurs
      fees; the in-memory default plus ISR is the right shape for this plan.
- [ ] Read `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`
      first. It is in the repo, it is version-accurate, and this Next diverges from
      training data.

---

### Phase 5 — Make the wait legible · ☐ open

- [ ] `loading.tsx` per route group — catalogue, detail, deals, sellers. Skeletons reuse
      the real components' box sizes so nothing shifts.
- [ ] Split the catalogue below the rail: `FilterRail` and the heading render from the
      URL alone. Only the results grid goes behind `<Suspense>`, keyed on the filter
      string.
- [ ] `useTransition` in `FilterRail` so a pending facet dims rather than looking ignored.
- [ ] Detail page: stream offers, reviews and price history below the fold; spec sheet
      and gallery land first.
- [ ] Drop `compress: false` from `next.config.ts`, or comment it as deliberate because
      Vercel's edge compresses. As written it serves uncompressed HTML from `next start`
      anywhere else.

---

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

## Open decisions

| Decision | Notes |
| --- | --- |
| Hobby vs Pro | Fair-use commercial definition, and whether 4 CPU-hrs / 5K image transformations are enough. Phases 1–3 help most on Hobby, since Hobby has no overage to buy. |
| Scrape cadence | Sets every `cacheLife` window in phase 4, and how fast `price_points` grows. |
| Catalogue page size | 24 or 36. A grid decision, not a performance one — both fix the payload. |
| Client-side search | The query filter is a JS `includes()`. Postgres has a search index on `rackets` going unused. |
| Whether phase 6 happens | Measure after 5. If green, it is a memory-footprint argument, not a speed one. |
