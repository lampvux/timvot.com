# Public Web Vitals optimization plan

**Branch:** `codex/optimize-public-web-vitals`
**Baseline date:** 2026-09-12
**Revision:** 2 — adds the deployment topology the first revision never established,
corrects two factual errors in it, and replaces every step that traded a feature away
for speed with one that does not.
**Scope:** homepage first, then every unauthenticated public route; authenticated account,
seller-dashboard, callback, and admin routes are explicitly out of the first rollout.
**Framework:** Next.js 16.3.1, React 19.2.8, Cache Components/PPR, Vercel Hobby.

This plan continues, rather than repeats, the completed work in
`docs/performance-plan.md`. Pagination, PPR, cached repository reads, server-rendered
catalogue cards, named Lucide imports, and crawler-produced thumbnails are already in
place.

---

## Implementation status

| Phase | State | Notes |
| --- | --- | --- |
| 0 — measurement gate | **partly shipped** | `scripts/warm-routes.ts` is the cold-path protocol and prints per-route cold TTFB. The Lighthouse/CI budgets still need the Vercel CLI and a Southeast Asian runner. |
| 1 — function region | **shipped, needs verification** | `vercel.json` pins `sin1`. Confirm Hobby accepts the key on a *preview* deploy before promoting. |
| 2 — auth round trips | **shipped** | Anonymous requests make zero Supabase Auth calls in proxy or account slot; the signed-in `profiles` query is folded into the token. Verified: `"service":"auth"` events = 0 on an anonymous render. `getClaims()` deferred — it only helps signed-in users and needs the asymmetric-key check first. |
| 3A — catalogue brands | **shipped** | One table, one round trip. Guarded by `read-path.test.ts` (mutation-tested). |
| 3B — homepage | **shipped, migration pending** | `getHomepageData()` — trending from `racket_market`, three `head:true` counts, deals from `deal_watch`. |
| 3C — sellers, guides, seller offers | **shipped** | `/compare`, `/finder`, `/strings` still read the snapshot; all measure ~1,0 s, the lowest-value remainder. |
| 3D — cold-cache survival | **shipped** | `npm run warm` after deploy and after the nightly scrape, both `continue-on-error`. |
| 4 — fonts | **shipped** | 24 files / 432 KB → **12 / 245 KB**. Dropping `latin-ext` proved safe against the *live* catalogue, not just the seed. |
| 5 — prefetch and priority | **shipped** | `prefetch = 'partial'` on all three detail routes; `preconnect` verified in emitted HTML; `priority` on 4+6 cards → exactly one `eager`. |
| 6 — responsive card images | **diagnosed, repair ready** | `npm run images:cache-repair` confirms **3.188 of 6.383 objects serve `Cache-Control: no-cache`**. Rewrite needs `--apply`. Rendition generation still outstanding — it needs a crawler run. |
| 7 — client JS floor | **partly shipped** | i18n payload −29% (server-only namespaces no longer reach the browser, verified in the RSC segment); `SiteFooter` moved to a Server Component; `staleTimes.dynamic: 30`. The rest of the floor measured as framework — see below. |
| 8 — lazy-load inventory | **partly shipped** | Similar-rackets already deferred; sparklines already server-rendered SVG. |
| 9 — CSS | **dropped, per its own exit criterion** | Measured at **19 KB gzipped** for the entire design system, one file, cached across all routes, Tailwind already tree-shaken. Not worth churning a design system for a fraction of that. |

Gates run after every phase: `npm run typecheck`, all four test suites (138
tests), and `npm run build` with its route table diffed. The table has stayed
at **52 `◐` / 20 `ƒ`** and 218 prerendered pages throughout.

### What the measurements changed

Three plan items did not survive contact with the code, and are recorded here
rather than quietly dropped:

- **`useLinkStatus` cannot replace the navigation progress bar.** It reports
  pending state inside a single `<Link>`'s own subtree; it cannot drive a
  global top bar. Phase 7.4 was written on a misreading. The bar is unchanged.
- **Scoping `CompareProvider` to route groups is not worth it.** A client
  provider that takes `children` does not make those children client
  components, so the provider costs only its own small bundle. The change
  would mean restructuring the whole URL-mapped directory tree for a gain too
  small to measure.
- **The client JS floor is framework, not chrome.** Measured per route:
  react-dom 224 KB, Next runtime ~284 KB, `@formatjs` (next-intl's ICU
  formatter) 51 KB, lucide 38 KB. The icon registry holds 27 icons of which 24
  are used — already tight, exactly as `CLAUDE.md` claims. Route-specific
  deltas are 14–24 KB. There is no large safe win left here.

### Needs a decision

1. **Apply `supabase/migrations/20260912000000_deal_watch.sql`**, then
   `npm run market:refresh`. Until then `getDeals()` logs its fallback and
   reads the whole price table — today's behaviour, so deferring is safe.
2. **Confirm the `sin1` region** on a preview deploy before promoting.
3. **`npm run images:cache-repair -- --apply`** rewrites 3.188 thumbnails with
   a one-year cache. Same bytes, same keys, metadata only; safe because every
   path carries a content hash. It is 3.188 writes against production storage,
   so it is yours to start.

### Found, not fixed

`npm run audit:glyphs` reports a CJK character, **U+3021 `〡`**, in the live
racket name `Auraspeed 10〡Làm Chủ Trận Đấu`. No Latin subset has ever covered
it, so it renders as a box today and did before this work. Scraped text to
correct at the source — `titleNoise`/`titleTransform` in the provider that
wrote it — not a font to reload.

---

## What changed in revision 2

Read this section first if you reviewed revision 1.

**Two causes were missing, and between them they are the largest term in every
number in the baseline table.**

1. **Nothing in the repository pins the Vercel function region, and the database is in
   `ap-southeast-1`.** There is no `vercel.json`, no `vercel.ts`, and no mention of a
   region anywhere in `src/`, `docs/`, or `.github/`. `DATABASE_URL` points at
   `aws-0-ap-southeast-1.pooler.supabase.com`. If the Vercel project is still on the
   default `iad1`, every PostgREST query crosses the Pacific twice. That single fact
   re-reads the whole baseline: a 35-round-trip price-history read is ~2.8 s from a
   laptop in Vietnam and ~9 s from `iad1`, which is why `/vi/rackets` closed at 23 s in
   production but the same read benchmarked at 6.6 s locally. **Phase 1 verifies and
   pins this before anything else is measured**, because every other number in this
   document is currently a measurement taken through that tax.

2. **Every public page view makes two Supabase Auth network calls, for anonymous
   visitors too.** `src/proxy.ts` calls `refreshSession()` → `supabase.auth.getUser()`
   on every matched request, and `src/components/auth-slot.tsx` calls `getUser()` again
   inside the layout's Suspense boundary on every route. Neither is skipped when the
   visitor has no session cookie. The middleware one sits in front of the first byte of
   a CDN-cached static shell. Removing both for anonymous traffic is a pure win with no
   behaviour change, and `CLAUDE.md` already sanctions the display-only cookie read that
   makes it legal.

**Two factual errors are corrected.**

3. **Be Vietnam Pro has no variable font.** Revision 1's Phase 2 opened with "convert
   Be Vietnam Pro from six static weights to its variable font". Next.js's own font data
   (`next/dist/compiled/@next/font/dist/google/font-data.json`) reports
   `axes: null` and no `"variable"` entry in its weight list for that family. The
   instruction cannot be carried out. The corrected font phase reaches a *lower* file
   count than revision 1 promised by other means — see Phase 4.

4. **`priority` is not the prop to reach for or remove in isolation.** In Next.js 16
   `priority` is deprecated **in favour of `preload`**, and the documentation's own
   guidance is that `loading="eager"` or `fetchPriority="high"` is usually the right
   instrument rather than either. Revision 1 said "remove `priority`", which would have
   left the catalogue LCP image with no priority signal at all. Phase 5 specifies the
   replacement per surface.

**Every step that was a downgrade is replaced.** You said you will not accept a
regression in anything. Revision 1 contained four:

| Revision 1 step | Why it was a downgrade | Revision 2 replacement |
| --- | --- | --- |
| `prefetch={false}` on product-card links | Removes viewport prefetch; every catalogue click then waits a full round trip | `export const prefetch = 'partial'` on the destination route. One shared App Shell per route replaces 3.010 per-link prefetches. Navigation gets *faster*, and the gallery preloads disappear. |
| `display: "optional"` on the data face | Invisible text for up to 100 ms, then a permanent fallback for that page view — prices and specs are the content | Dropped. `swap` stays on all three faces. |
| Remove the global navigation-progress bar | Loses navigation feedback on slow connections | Keep the bar; move its cost off the document and behind `useLinkStatus` per link. Removal only if field data shows it is never seen. |
| `content-visibility: auto` on long sections | Can break find-in-page and in-page anchors | Kept, but gated behind an explicit verification checklist, applied below the fold only, and dropped if any check fails. |

**One target is now a contract rather than an aspiration.** You asked for nothing
slower than two seconds to fully display. That is stricter than Google's 2.5 s LCP gate
and it needs a per-resource budget to be enforceable, not just a threshold to be
measured. See "The two-second contract" below.

---

## Deployment topology

Established from the repository, not assumed. Confirm the two items marked **VERIFY**
in Phase 1 before acting on anything downstream of them.

| Layer | What the repository says | Consequence |
| --- | --- | --- |
| Database | Supabase, `aws-0-ap-southeast-1` (Singapore), shared pooler, project `jpndtobbacllovsnnshh` | ~1–3 ms intra-region from a Singapore function; ~230–250 ms from `iad1` |
| Object storage | Same Supabase project, `*.supabase.co/storage/v1/object/public/**`, behind Supabase's Cloudflare CDN | A **third origin** for the browser. No `preconnect` exists today. |
| Functions | **VERIFY** — no `vercel.json`, no `vercel.ts`, no `regions` key anywhere in the repository. The Vercel project default applies, and Vercel's default for a new project is `iad1`. | If `iad1`, every query pays ~250 ms. Hobby permits exactly one region and it is selectable. |
| Build | GitHub Actions, `vercel build --prod` then prebuilt deploy (`.github/workflows/deploy-production.yml`). 4 static workers, 55 pages/worker ceiling. | Prerenders ~70 rackets × 2 locales. The other ~2.940 detail pages serve an App Shell and render at runtime. |
| Plan | Hobby — 4 h Active CPU/month, 5.000 image transformations/month (both stated in `next.config.ts`) | CDN hits cost nothing; function invocations are the rationed resource. Reinforces PPR, does not change it. |
| Cache | `cacheComponents: true`, plain `use cache` only. Per Next 16.3 docs, plain `use cache` is **in-memory per instance** and is not durable or shared. | A new instance, or any deploy (build ID is part of the cache key), starts cold. This is the mechanism behind the measured 18,57 s cold `/vi/sellers/vnb`. |
| Audience | Vietnam-first (`vi` default, `localeDetection: true`) | Nearest Vercel POP is `sin1`, ~30–50 ms RTT from HCMC/Hanoi on good mobile. That RTT is the floor every budget below is built on. |

---

## Target outcome

All public route groups pass Core Web Vitals at the 75th percentile on both mobile and
desktop, **and** meet the stricter internal display contract.

| Metric | Google gate (p75 field) | This project's gate (p75 field) | Lab gate (median of 3, mobile) |
| --- | ---: | ---: | ---: |
| LCP | `<= 2.5 s` | `<= 2.0 s` every public route | `<= 2.0 s` |
| **Visually complete** | — | **`<= 2.0 s` every public route** | `<= 2.0 s` |
| INP | `<= 200 ms` | `<= 150 ms` | `<= 150 ms` |
| CLS | `<= 0.10` | `<= 0.05` | `<= 0.05` |
| TTFB | — | `<= 500 ms` | `<= 500 ms` |

"Visually complete" is the extra gate your requirement adds: on this site the LCP
element is often text that paints before the product images and the streamed catalogue
result land, so an LCP of 1,8 s can sit in front of a page that is still assembling at
6 s. It is measured as Lighthouse **Speed Index** plus a request-log check that no
above-the-fold image or streamed section finishes after 2,0 s.

Field data at p75 decides. Lighthouse is the reproducible regression signal.

---

## The two-second contract

A threshold alone cannot be enforced during implementation — you only find out at the
end. This is the same two seconds, decomposed into budgets each phase can be held to.
Reference visitor: mobile, 4G, HCMC, cold cache, cold URL.

| Segment | Budget | Owned by | Notes |
| --- | ---: | --- | --- |
| DNS + TLS to the Vercel POP | 150 ms | Platform | `sin1` POP, ~35 ms RTT, 3 round trips |
| TTFB, CDN-cached static shell | +100 ms | Phases 1–2 | A CDN hit must not invoke a function. Today the proxy's auth call does. |
| HTML + critical CSS arrives | +150 ms | Phase 8 | ~20 KB br HTML, ~19 KB br CSS, one round trip on H2 |
| Preconnect to Supabase storage | overlapped | Phase 5 | Must start in the `<head>`, not on image discovery |
| Fonts for the first viewport | +200 ms | Phase 4 | ≤ 3 preloaded files, ≤ 80 KB total. Text is already painted in the metric-matched fallback; this is the swap. |
| LCP image decoded | +400 ms | Phases 5–6 | ≤ 45 KB AVIF/WebP card rendition, same connection as the preconnect |
| Streamed dynamic hole complete | +600 ms | Phases 2–3, 7 | The catalogue result, the account slot, the compare tray. This is the segment that is 20 s today. |
| Hydration to interactive | +300 ms | Phase 7 | Overlaps the above; must not delay paint |
| **Visually complete** | **≈ 1,6 s** | | 400 ms of headroom against the 2,0 s contract |

Two budgets in that table are violated by roughly an order of magnitude today: TTFB and
the streamed hole. They are Phases 1–3. Nothing in Phases 4–8 can recover a 20-second
streamed hole, which is why the ordering below differs from revision 1.

---

## Production baseline

Carried forward from revision 1, with the interpretation corrected.

### Lighthouse, mobile simulated throttling

One live run per route. Repeat each route three times and use the median before
implementation; these single runs locate bottlenecks and are not stable scorecards.

| Route | Score | FCP | LCP | TBT | CLS | Speed Index |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/vi` | 98 | 1.6 s | 2.3 s | 20 ms | 0 | 1.9 s |
| `/vi/rackets` | 69 | 1.3 s | 6.1 s | 20 ms | 0 | 9.6 s |

`/vi` scores 98 and still fails this project's gates: LCP 2,3 s against a 2,0 s target,
Speed Index 1,9 s with no margin. The catalogue's shell paints fast and the useful
result arrives much later; Lighthouse attributed 17,3 s of its LCP to resource-load
delay, because the first product image was not discoverable until the streamed result
completed.

### Initial-load resources

| Route | Requests | Transfer | Images | Fonts | JavaScript | Unused JS estimate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/vi` | 61 | 1.55 MB | 746 KB | 432 KB / 24 files | 261 KB | 73 KB |
| `/vi/rackets` | 70 | 3.56 MB | 2.72 MB | 432 KB / 24 files | 270 KB | 57 KB |

Three catalogue-card links automatically prefetched their detail routes. Those
prefetched routes emitted full-gallery image preloads, downloading **2,53 MB across
three original images before the visitor expressed intent to open any card**. The
homepage did the same for one 665 KB original. All were low-priority link preloads, but
they consumed bandwidth and pulled in the detail-only client chunk, which Lighthouse
found effectively unused on the current page.

The 24 font files are now accounted for exactly:

| Face | Kind | Subsets | Weights | Files |
| --- | --- | ---: | ---: | ---: |
| Archivo | variable (`wdth`, `wght`) | 3 | — | 3 |
| Be Vietnam Pro | **static only — no variable font exists** | 3 | 6 | 18 |
| JetBrains Mono | variable (`wght`) | 3 | — | 3 |
| | | | | **24** |

All 24 are high-priority preloads.

### Server and streaming spot checks

Compressed `curl` document timings, not Web Vitals. `total` is when the final streamed
HTML closed.

| Route | TTFB | Total | Observation |
| --- | ---: | ---: | --- |
| `/vi` | 0.39 s | 3.51 s | Fast cached shell; dynamic slots keep streaming. |
| `/vi/rackets` | 0.38 s | 23.14 s | Fast shell, critically late catalogue result. A repeat was still 20.40 s. |
| `/vi/rackets/yonex/arcsaber-11-pro` | 0.35 s | 0.99 s | Detail read path is already query-shaped. |
| `/vi/deals` | 0.86 s | 3.14 s | Whole-snapshot path remains. |
| `/vi/compare` | 0.56 s | 1.04 s | Acceptable, but still whole-snapshot by slug. |
| `/vi/finder` | 0.59 s | 1.06 s | Empty quiz is light; result mode still loads all rackets. |
| `/vi/strings` | 0.62 s | 1.24 s | Separate string repository; verify in its own cohort. |
| `/vi/strings/yonex/exbolt-65` | 1.74 s | 2.16 s | Already over the contract before any asset work. |
| `/vi/sellers` | 0.84 s | 3.09 s | Whole-snapshot path remains. |
| `/vi/sellers/vnb` cold / hot | 18.57 / 0.89 s | 21.00 / 3.62 s | Cache-fill penalty. The cold number is the one that matters for a p75 promise. |
| `/vi/guides` | 0.84 s | 3.17 s | A guide-only read depends on the whole snapshot. |
| `/vi/methodology` | 0.66 s | 1.36 s | Static content control route. **0,66 s TTFB on a route with no data read at all** — that is the proxy's auth round trip plus the account slot's, and it is the floor under every row above. |

That last row is the tell. `/vi/methodology` reads nothing from the catalogue and still
takes 660 ms to first byte. Subtract the POP RTT and what is left is two Supabase Auth
calls to Singapore. Every other TTFB in the table sits on top of it.

### Read-path benchmark, against the linked project

| Read | Measured cost |
| --- | ---: |
| Query-shaped catalogue page | 126 ms / 1 KB |
| Hydrate 24 rackets | 121 ms / 53 KB |
| Entire uncached snapshot | ~6,6 s / 9,4 MB |
| Price history inside that snapshot | 4,2 s / 3,3 MB / 35 round trips |

Read those with `baseline:round trip` subtracted, as `CLAUDE.md` instructs — and then
read them again with the region question in mind. The 35 round trips are the term that
changes most between a Singapore function and a Virginia one.

`/rackets` performs the good page-and-hydrate reads, then calls `getBrands()`, which
calls `loadSnapshot()` and pays the 9,4 MB path on a cache miss. Because plain
`use cache` is in-memory per instance, that miss is routine in production, not rare.
The same whole-snapshot reads remain on home, deals, finder results, compare, sellers,
seller detail, and guides.

### Build and client baseline

- `npm run build` passes.
- Every unauthenticated public route is Partial Prerendered (`◐`); private account and
  seller routes are dynamic (`ƒ`). This route table must not regress.
- Raw client entry: ~119 KB home, ~129 KB catalogue, ~389 KB racket detail, ~105 KB
  even for content-only pages (guides, methodology, strings, sellers).
- The 105 KB floor is app-wide client chrome/providers, analytics, navigation progress,
  and next-intl, on pages with no interactive feature.
- One global stylesheet, ~19 KB compressed, measured by Lighthouse at 160–300 ms of
  render-blocking work.

---

## Root-cause ledger

Ranked by estimated share of the gap between today and the two-second contract. Each
phase below closes one line.

| # | Cause | Where | Est. cost on a public page view | Phase |
| ---: | --- | --- | ---: | ---: |
| 1 | Function region may not match the database region | Vercel project settings (unset in repo) | ×~100 on every round trip if `iad1` | 1 |
| 2 | `supabase.auth.getUser()` in the proxy, for anonymous visitors too | `src/proxy.ts`, `src/lib/supabase/proxy.ts` | 250–500 ms TTFB, every request | 2 |
| 3 | `getUser()` again in the account slot, plus a `profiles` query | `src/components/auth-slot.tsx` | 250–500 ms streamed hole, every route | 2 |
| 4 | `getBrands()` → `loadSnapshot()` on the catalogue's dynamic path | `src/app/[locale]/rackets/page.tsx:90` | up to 20 s on a cache miss | 3 |
| 5 | Whole-snapshot reads on home, deals, sellers, guides, compare, finder | `src/lib/data/repository.ts` | 3–6 s streamed hole each | 3 |
| 6 | In-memory-only cache; every deploy and every new instance starts cold | `use cache` default handler | 18 s outliers | 3 |
| 7 | 24 preloaded font files, 432 KB, at highest priority | `src/app/fonts.ts` | 300–600 ms of LCP competition | 4 |
| 8 | Per-link full prefetch of detail routes, with gallery preloads | default `<Link>` behaviour | 2,53 MB before intent | 5 |
| 9 | No `preconnect` to the Supabase storage origin | `src/app/[locale]/layout.tsx` | 200–300 ms before the first card image | 5 |
| 10 | `unoptimized` 400 px thumbnail served into a 48 px slot; `Cache-Control: no-cache` on storage objects | `racket-card-view.tsx`, storage metadata | 2,7 MB of image waste; no repeat-visit caching | 6 |
| 11 | 105 KB client floor on pages with no interactivity | `site-chrome.tsx`, providers, next-intl | TBT/INP headroom, ~250 ms parse on mid-range Android | 7 |
| 12 | 19 KB render-blocking stylesheet | `src/app/globals.css` | 160–300 ms | 8 |

---

## Implementation plan

Phases run in this order because each one's measurement is only trustworthy once the
phase above it is done. Phases 1 and 2 are configuration and small code changes with no
product surface; they are also the two largest terms.

### Phase 0 — Make measurement a release gate

1. Install Vercel CLI v53 or newer (`npm i -g vercel`), authenticate, and link this app
   to the exact project/account scope. This unlocks `vercel metrics`, `vercel usage`,
   `vercel logs`, `vercel env pull`, and preview measurement. Do not infer the scope
   from the current CLI team.
2. Export the last 14 days of Speed Insights/route metrics by route, device class,
   country, and navigation type. Record p75 LCP, INP, CLS, TTFB, and sample count.
   **Filter to Vietnam separately** — a global p75 on a Vietnam-majority audience will
   hide exactly the regional effects Phase 1 is about. Speed Insights is already
   mounted; keep it.
3. Add a repeatable mobile Lighthouse job for the route cohorts below. Three cold
   profiles and three warm profiles, publish the median, retain the JSON artifacts.
   Run it from a Southeast Asian location, not a US CI runner — a US runner measuring a
   US function against a Singapore database will report numbers no real visitor sees.
4. Add budgets that fail CI or the preview check:
   - home: score `>= 95`, LCP `<= 2.0 s`, **Speed Index `<= 2.0 s`**, TBT `<= 150 ms`,
     CLS `<= 0.05`, transfer `<= 700 KB`;
   - catalogue: score `>= 90`, LCP `<= 2.0 s`, **Speed Index `<= 2.0 s`**, TBT
     `<= 150 ms`, transfer `<= 900 KB`;
   - all remaining public routes: score `>= 90`, LCP `<= 2.0 s`, Speed Index
     `<= 2.0 s`, TBT `<= 150 ms`, CLS `<= 0.05`;
   - no unexpected full-resolution product image on a list or landing page;
   - no regression from `◐` to `ƒ` in the public build route table;
   - **no reduction in prerendered page count** (`PRERENDERED_RACKETS` and the string
     detail pages).
5. Add route-level server timing around the task-shaped repository reads. The existing
   `RACKET_DETAIL_PROFILE` instrumentation (`docs/racket-detail-profiling.md`) already
   separates `service: "rest"` from `service: "auth"` — widen it to the public routes,
   because the auth/REST split is exactly what Phase 2 changes. A green build is not
   latency evidence.
6. Record a **cold-path protocol** and use it for every exit criterion: deploy, then
   measure the very first request to each route before any other traffic. Warm numbers
   cannot prove the contract; the 18,57 s seller page was a warm-looking route on a
   cold instance.

**Exit:** a checked-in baseline table exists for both locales' route templates, field
sample counts are known and segmented by country, and preview/production changes can be
compared with one procedure that includes a cold run.

---

### Phase 1 — Put the function in the same region as the database

The highest-leverage change in this document, and it is configuration.

1. **VERIFY** the current function region: `vercel project ls`, then the project's
   Settings → Functions → Region, or read `.vercel/project.json` after `vercel pull`.
   Record it in the baseline table. Hobby allows exactly one region, and it is
   selectable.
2. **VERIFY** the Supabase project's region in the dashboard. `DATABASE_URL` says
   `aws-0-ap-southeast-1`; confirm the API/PostgREST endpoint agrees.
3. If they differ, set the Vercel function region to **`sin1` (Singapore)** — the
   same AWS region family as `ap-southeast-1`, and the nearest Vercel region to the
   Vietnamese audience. Pin it in the repository so it cannot drift:

   ```json
   // vercel.json
   { "regions": ["sin1"] }
   ```

   Confirm the Hobby plan accepts the key at deploy time; if it does not, set it in
   project settings and add a workflow assertion that reads it back, so the repository
   still fails loudly if someone changes it.
   Do **not** use `export const preferredRegion` — it is deprecated in Next.js 16 and
   only accepts `'auto' | 'global' | 'home'` on Vercel.
4. Re-run the full `curl` table and `npm run benchmark` from a Singapore or Vietnam
   vantage point. Every `sql` row should drop by roughly the old `baseline:round trip`
   value times its round-trip count.
5. Re-baseline. **Every measurement in this document taken before this step is
   provisional**, and the phases below must be re-measured against the new baseline
   rather than against revision 1's table.

**Why this is not a risk.** Moving regions changes no code, no schema, and no product
surface. The failure mode is neutral: a region that is farther from the database, which
is the current state. Rollback is one setting or one reverted line. Two things to
confirm rather than assume: (a) any IP allow-list on the Supabase project must include
the new region — the shared pooler does not allow-list by default, so this is a check,
not a task; (b) the daily scraper runs in GitHub Actions, not on Vercel, so it is
unaffected.

**Exit:** function region and database region are the same, pinned in the repository or
asserted by the workflow, and `baseline:round trip` measured from the function is under
10 ms.

---

### Phase 2 — Remove the auth round trips from anonymous page views

Two `getUser()` calls per page view, both network calls to Singapore Auth, both on
routes that have no signed-in content. The overwhelming majority of public traffic is
anonymous and carries no Supabase auth cookie at all.

1. **Short-circuit `refreshSession()` when there is no session to refresh.** Supabase
   writes its auth token as `sb-<project-ref>-auth-token` (possibly chunked with
   `.0`/`.1` suffixes). When no cookie with that prefix is present on the request,
   return the next-intl response unchanged and make no Supabase client at all. Derive
   the prefix from `SUPABASE_URL` rather than hard-coding the ref.
   *No behaviour change:* a visitor with no session has nothing to refresh, and the
   current code already returns the same response after paying for the call.
2. **Replace `getUser()` with `getClaims()` where a cookie does exist.** `getClaims()`
   verifies the JWT locally against the project's JWKS when the project uses asymmetric
   signing keys, turning a per-request round trip into a cached key fetch.
   **VERIFY first** in the Supabase dashboard (Authentication → JWT Keys) that the
   project is on asymmetric keys; with a legacy HS256 secret `getClaims()` falls back to
   a network call and this step is a no-op rather than a win. Migrating the signing key
   is a separate, reversible task with its own rollout — do not fold it into this phase.
   Keep `getUser()` anywhere a decision is security-relevant. Nothing in the proxy is.
3. **Make `AccountSlot` cookie-first.** `src/components/auth-slot.tsx` decides which
   icon link to paint and nothing else — its own header comment says so, and `CLAUDE.md`
   explicitly permits reading auth state optimistically from cookie presence *for
   display*. When no auth cookie is present, render the signed-out link with no network
   call. When one is present, resolve as today.
   *No behaviour change for a signed-in visitor.* For an anonymous one the same markup
   is produced, sooner.
4. **Fold the `profiles` lookup into the same resolution.** A signed-in visitor
   currently pays `getUser()` plus a `profiles` select, serially, on every route.
   Prefer `display_name` already carried in the JWT's `user_metadata`; fall back to the
   query only when it is absent. This is the signed-in surface, so it is out of the
   public cohort's exit criteria — but it is the same three lines of code and should be
   done here.
5. **Confirm the proxy matcher is not doing avoidable work.** It already excludes
   `api`, `auth`, `_next`, `_vercel`, and anything with an extension. After step 1 the
   remaining work is locale resolution, which is CPU-only. Verify no Supabase client is
   constructed on an anonymous request, with a test.
6. Add a test asserting that a request carrying no `sb-*-auth-token` cookie performs
   **zero** requests to the Supabase Auth origin, across proxy and render. This is the
   regression guard for the whole phase.

**Exit:** `/vi/methodology` TTFB under 200 ms cold; the profiler reports zero
`service: "auth"` events on an anonymous request to every public route; signed-in
navigation still shows the account menu with no visible change.

---

### Phase 3 — Finish task-shaped reads, and make the cache survive a cold instance

The old performance plan's phase 6 becomes mandatory. Keep one public repository API per
task, with Supabase and seed implementations behind the same signature.

#### 3A. Catalogue first

1. Replace `getBrands()` in `/rackets` with a cached `getCatalogBrands()` reading only
   the ~36 brand rows and only the fields the filter UI uses. `orderBrandsByPopularity`
   needs `{ slug, name }` and nothing else, so the contract is small.
   It must never call `loadSnapshot()`.
2. Keep the existing page query, facets query, and 24-racket hydration as the first safe
   change. Then measure whether combining page, facet counts, brand labels, and
   hydration into one RPC saves enough round trips to justify the larger database
   contract. After Phase 1 a saved round trip is worth ~2 ms, not ~250 ms — **re-decide
   this with the post-Phase-1 numbers**, because it was worth far more before.
3. Return the first card's image URL in the first streamed chunk so the browser can
   discover the LCP asset the moment the query resolves.
4. Add a regression test that fails if `/rackets` reaches `loadSnapshot`, `price_points`,
   all offers, or all image rows.

#### 3B. Homepage

Create `getHomepageData(locale)` returning only:

- four ranked card records;
- three deal rows and the eight price points each sparkline draws;
- three guide summaries;
- counts for rackets, active listings, and verified sellers.

Today the page reads 3.010 rackets, the whole price table, all offers and all sellers to
render seven small records and three counts.

Make the ranking a stored projection rather than a query to re-derive per request.
`scripts/refresh-market.ts` already computes and stores Court Score in `racket_scores`
after every sync; extend it to write the homepage's trending set and counts the same
way. Court Score stays defined only in `src/lib/court-score.ts` — the script computes,
the database stores, the migration never restates product logic. That keeps the
homepage's data read at one bounded query and keeps the published methodology the single
definition, per `CLAUDE.md`.

#### 3C. Remaining discovery routes

- `/deals`: query the deal rows, relevant variant, seller count, and a bounded price
  window directly.
- `/compare`: query only the requested two-to-four slugs, in the user's order.
- `/finder`: keep the quiz shell data-free. For results, fetch a minimal ranking
  projection or rank server-side, then hydrate only the shortlist.
- `/sellers`: fetch seller directory fields only.
- `/sellers/[slug]`: fetch one seller and that seller's bounded offers; remove the
  `getSellers()` whole-index dependency from both metadata and page render.
- `/guides`: fetch guide summaries only, or make the small editorial dataset a direct
  static source if database editing is not required.
- `/strings`, `/strings/[brand]/[model]`: keep the separate repository, cap history and
  offers to what each page renders, benchmark against the same budgets.
  `/vi/strings/yonex/exbolt-65` is already at 2,16 s and is the first route to fail the
  contract outright.

#### 3D. Survive a cold instance

This is the phase's other half and revision 1 treated it as optional. It is not
optional under a p75 promise: an 18,57 s cold TTFB on one route in fifty is a p98 that
no amount of warm-path work hides.

1. **Warm the cache after every deploy.** The build ID is part of the `use cache` key,
   so a deploy invalidates every entry and the first visitor to each route pays the
   fill. Add a step to `.github/workflows/deploy-production.yml`, after the deploy and
   its alias promotion, that requests every public route template in both locales plus
   the top N racket and string detail pages. It is a handful of requests, it runs
   outside the user's critical path, and it converts the worst outlier in the baseline
   into nothing.
2. **Warm again after the nightly scrape.** `scrape:sync` already calls
   `/api/revalidate`. Follow that with the same warm sweep, so the first morning
   visitor gets a filled cache rather than filling it.
3. **Evaluate `use cache: remote` on the catalogue's request-time reads only.** The
   Next.js 16.3 documentation's stated case for it is content deferred to request time,
   where each serverless instance has its own ephemeral memory and low hit rates —
   which is exactly `getCatalogPage` and its facets. Test it on those two functions,
   measure the lookup cost from `sin1` (after Phase 1 it is a same-region hop), and keep
   it only if it wins. Do not apply it to `readSnapshot`: caching a 9,4 MB task
   mismatch is hiding the bug, and the same documentation says as much.
4. Keep cache tags and scraper-triggered revalidation exactly as they are.

**Exit:** no unauthenticated public request calls `loadSnapshot()` or `loadIndex()`;
uncached PostgREST transfer under 250 KB per route; catalogue streamed content completes
under 600 ms warm and 1,0 s cold; every public route's **cold** TTFB under 500 ms;
Lighthouse median LCP and Speed Index under 2,0 s on the catalogue.

---

### Phase 4 — Collapse the 24-file font critical path

Revision 1's opening instruction here was impossible: **Be Vietnam Pro has no variable
font on Google Fonts.** Next.js's bundled font data reports `axes: null` and no
`"variable"` weight for the family. Archivo and JetBrains Mono are already variable and
already cost one file per subset. The 18 remaining files are all Be Vietnam Pro:
6 weights × 3 subsets.

Three tiers. Do them in order and stop when the budget is met.

**Tier 1 — remove what is provably unused (no visual change at all).**

1. Drop weight `300`. It is declared in `src/app/fonts.ts` and referenced nowhere: the
   codebase uses `font-medium` (500), `font-semibold` (600), `font-bold` (700),
   `font-extrabold` (800) and the 400 default. 18 → 15 files.
2. Audit which of 500/600/700/800 actually resolve to Be Vietnam Pro rather than to
   Archivo. `--font-display` (Archivo) owns `h1`–`h6`, `.display` (800), `.eyebrow`
   (700); `--font-mono` (JetBrains) owns `.price` (600) and `.data`. A `font-bold` on a
   heading is Archivo, not Be Vietnam Pro. **Measure, do not infer**: DevTools →
   Rendered Fonts, per weight, on `/vi` and `/vi/rackets` in both locales. Remove only
   weights with zero rendered usage. Likely 15 → 12 files.
3. Run a codepoint audit over `messages/vi.json`, `messages/en.json`, brand names,
   racket model names, seller names, and string model names. If nothing outside
   `latin` + `vietnamese` appears, drop `latin-ext` from all three faces.
   Google's `vietnamese` subset carries only the Vietnamese-specific codepoints, so
   `latin` must stay for both locales — do not drop it. 12 → 8 files for Be Vietnam Pro,
   Archivo 3 → 2, JetBrains 3 → 2. **Total 24 → 12.**
4. Add a test that fails when a message file or a scraped name introduces a codepoint
   outside the retained subsets. Without it, the next scrape can silently ship tofu.

**Tier 2 — stop preloading what the first viewport does not paint.**

5. `next/font` preloads every file of every face whose class is rendered. Split Be
   Vietnam Pro into two instances: the weights the first viewport paints
   (`preload: true`) and the rest (`preload: false`, discovered by CSS when first
   matched). Both remain available, both remain self-hosted, nothing changes visually —
   the non-critical weights simply stop competing at highest priority with the LCP
   image. Verify per route, because the home hero and a catalogue card paint different
   weights.
6. Keep `display: "swap"` and the default metric-adjusted fallback on **all three**
   faces. Revision 1 proposed `display: "optional"` for the data face; that trades a
   permanent fallback for prices and specs on a slow first load, and is dropped.

**Tier 3 — only if Tier 1+2 miss the 80 KB budget.**

7. Self-host custom subsets through `next/font/local`: one `woff2` per Be Vietnam Pro
   weight covering exactly the `latin` + `vietnamese` codepoints the site can render,
   built in the scraper toolchain with `pyftsubset` and checked in. That is one file per
   weight instead of two, with a smaller payload each. It adds a build dependency, which
   is a maintenance cost rather than a user-facing risk, and the codepoint test from
   step 4 becomes the guard that keeps it honest.

8. Compare Vietnamese and English screenshots at mobile and desktop widths after each
   tier: clipping, fallback shift, missing diacritics, tabular-figure alignment in
   prices. Vietnamese runs 20–30% longer than English; check the longest strings, not
   the representative ones.

**Exit:** at most 12 font files on initial navigation and at most 3 preloaded; font
transfer under 160 KB total and under 80 KB preloaded; no missing glyphs in either
locale; CLS stays at 0; font requests no longer compete at highest priority with the LCP
resource.

---

### Phase 5 — Fix prefetch and resource priority without losing navigation speed

Revision 1's answer here was `prefetch={false}` on card links, which buys the 2,53 MB
back at the cost of every catalogue click waiting a full round trip. Next.js 16.3 has
the exact tool for this, and it makes navigation faster rather than slower.

1. **Adopt Partial Prefetching on the destination route, not the link.** Set
   `export const prefetch = 'partial'` on `src/app/[locale]/rackets/[brand]/[model]/page.tsx`.
   A `<Link>` pointing at that route then loads the route's shared **App Shell** —
   one shell reused by every link to the route, regardless of params — instead of a
   separate full prefetch per card. The gallery preloads and the detail-only client
   chunk are not in the shell, so the 2,53 MB and the unused chunk both disappear, and
   the click still lands on prefetched markup.
   Card links keep their default prefetch. Nothing is disabled.
2. Apply the same export to `/sellers/[slug]` and `/strings/[brand]/[model]`, which have
   the same many-links-to-one-route shape.
3. Once every route in the public cohort carries it and the numbers hold, set
   `partialPrefetching: true` in `next.config.ts` and remove the per-route exports. The
   per-route export exists precisely so this can be adopted incrementally rather than as
   one flip — take that path.
4. **Use `next dev`'s instant-navigation insights as the checklist.** Next.js 16.3
   surfaces two development-only insights that name the link or route to change:
   `instant-link-prefetch-partial` and `instant-shell-url-data`. They never block a
   build, so they will not be seen in CI — open every touched route in `next dev` and
   clear them. `CLAUDE.md` already warns that some Cache Components validation only runs
   in development; this is that rule with a specific checklist attached.
5. **Review the chrome's own prefetching.** The homepage issues sixteen route payload
   fetches before any interaction, from `TopBar`, `SiteFooter`, and `MobileTabBar`.
   After step 3 each of those is one shared App Shell rather than a full page prefetch,
   which likely resolves it outright. Re-measure before removing any prefetch by hand;
   if any remain expensive, keep prefetch on the primary destinations and move only the
   footer's long tail to intent-based.
6. **Correct the image priority API.** `priority` is deprecated in Next.js 16 in favour
   of `preload`, and the documentation's guidance is that `loading="eager"` or
   `fetchPriority="high"` is usually the better instrument. Per surface:
   - **home**: the measured LCP is text. Remove `priority={index < 4}` from the trending
     cards entirely — four preloaded images that are not the LCP element only delay the
     one that is. They keep the default `loading="lazy"`.
   - **catalogue**: `priority={index < 6}` preloads six. Replace with
     `fetchPriority="high"` + `loading="eager"` on the **first card only**, and only
     once Phase 3 makes the result arrive early enough for that to matter. Cards 2–6
     revert to lazy; on a mobile viewport they are below the fold anyway.
   - **racket detail**: keep exactly one hero preload, on a real detail navigation. With
     step 1 in place it can no longer fire as a side effect of a prefetched card link.
7. **Add `preconnect` to the Supabase storage origin** in
   `src/app/[locale]/layout.tsx`. Card thumbnails are served `unoptimized` straight from
   `*.supabase.co`, a third origin the browser does not meet until it parses the first
   `<img>`. On mobile that is a DNS + TCP + TLS handshake — 200–300 ms — inserted in
   front of the LCP image. One `<link rel="preconnect" crossOrigin="anonymous">` in the
   head removes it. Add `dns-prefetch` as the fallback for browsers that cap
   preconnects.
8. Verify with the Lighthouse request log and the network waterfall, not by reading
   markup.

**Exit:** home and catalogue download zero full-gallery originals before intent; the
2,53 MB prefetch and the unused detail chunk are gone from catalogue initial load; the
first card image starts within 150 ms of the streamed result; click-to-render on a
catalogue card is no slower than today, measured — that is the no-downgrade gate for
this phase.

---

### Phase 6 — Serve responsive, cacheable card images

1. Extend the crawler thumbnail pipeline with at least a small card rendition alongside
   the existing large one. Choose widths from measured rendered sizes and DPRs; the
   card's own `sizes` attribute asks for 96 px on mobile and ~190–290 px in the grid, so
   ~160–200 px and ~400 px are the likely pair.
2. Emit a real `srcset`/`sizes` mapping for the pre-generated assets. `unoptimized` today
   discards the intent of `sizes` entirely, which is why Lighthouse sees a 400×600
   source in a 48×72 slot.
3. Preserve the explicit intrinsic aspect ratio, the `fill` geometry, and the current
   placeholder so CLS stays at 0.
4. **Repair object cache metadata.** The uploader asks for a one-year cache but the live
   public response returns `Cache-Control: no-cache` with `CF-Cache-Status: MISS`, so
   Supabase's CDN re-fetches from Singapore every time and the browser caches nothing
   between visits. Backfill the metadata or version/re-upload the immutable objects,
   then verify the live response headers. The content hash in each path makes a long TTL
   safe: a changed image gets a changed key.
5. Serve AVIF with a WebP fallback for the pre-generated renditions if the crawler's
   `sharp` pipeline produces both cheaply. Measure; keep only if the decode cost on a
   mid-range Android does not eat the transfer saving.
6. Keep crawler-generated fixed renditions as the default. Do not move the catalogue
   back to unbounded Vercel image transformations — the Hobby allowance is 5.000/month
   against 3.010 hero images, and exceeding it returns 402 and renders alt text. That is
   a correctness constraint, not a cost preference.
7. Keep the image ownership/equivalence tests passing (`npm run test:image-scraper`).

**Exit:** catalogue image waste falls at least 80% from the current Lighthouse estimate;
repeat visits receive a long browser cache lifetime and `CF-Cache-Status: HIT`; no card
downloads an original; LCP image transfer under 45 KB.

---

### Phase 7 — Lower the app-wide client JavaScript floor

Every item here is a boundary move, not a feature removal.

1. Split `src/components/site-chrome.tsx` (319 lines, entirely `"use client"`) into
   server-rendered navigation and footer markup plus leaf client islands for the mobile
   search toggle, the active-route decoration, and the language switcher. One `useState`
   for a search toggle currently makes the whole chrome a Client Component on every
   route. The `usePathname()` calls are already isolated behind Suspense — keep that
   shape and shrink what surrounds it.
2. Scope compare state to the route groups that expose comparison actions: home,
   catalogue, racket detail, deals, finder results, compare. Guides, methodology,
   sellers, strings, and the auth entry pages should not hydrate `CompareProvider`.
   `CompareToggle` renders inside every one of the 24 catalogue cards, so this is also
   the largest single client-instance count on the busiest page.
3. Reduce the root `NextIntlClientProvider` payload. `messages/vi.json` is 30 KB and
   `en.json` 26 KB, and the whole file currently reaches the client. Prefer
   server-translated chrome with explicit labels passed to small client leaves; where a
   provider is still needed, pass only that subtree's namespaces.
   `getTranslations` does on the server what `useTranslations` does on the client —
   `CLAUDE.md` already says needing translations is not a reason to go client.
4. Replace the document-wide navigation-progress click listener and timers with
   Next.js 16's `useLinkStatus` for per-link pending feedback. **Keep the global bar**
   until field navigation latency shows it is never seen; revision 1 proposed removing
   it, which is a feedback regression on exactly the slow connections this plan is for.
   The goal is to stop paying for a document-level listener and a timer on every page,
   not to stop showing progress.
5. Set `experimental.staleTimes: { dynamic: 30 }`. The default is 0, so returning to
   `/rackets` from a detail page refetches the whole result even when the visitor was
   there two seconds ago. Thirty seconds of client-cache reuse makes back-navigation
   instant; prices move nightly, so the freshness cost is nil. Reversible in one line.
6. Keep Analytics and Speed Insights — they are the field evidence that closes this
   work. Confirm both stay deferred and neither becomes an LCP dependency.
7. Re-run `next experimental-analyze --output` after each boundary change and record raw
   and transferred route entries.

**Exit:** content-only public pages under 70 KB raw route client entry, home under 90 KB,
catalogue under 100 KB, initial-route unused JavaScript under 20 KB, INP p75 under
150 ms, and no TBT regression on any route.

---

### Phase 8 — Lazy-load everything that is not first-viewport

Collected here rather than scattered, because you asked for it as a principle. Each item
defers work without removing it; nothing here changes what a visitor can see or do.

| Surface | Today | Change |
| --- | --- | --- |
| Similar rackets (detail) | Already `IntersectionObserver` + 400 px margin, small cached API | **Done** — use it as the template |
| Racket gallery (detail) | Client component, all images in the initial tree | Render the hero server-side; mount the swipe/zoom client gallery on first interaction or on approach. The hero must not wait for hydration. |
| Compare tray | Provider at the root, tray hydrates everywhere | Phase 7.2 scopes it; additionally the tray body is empty until localStorage is read, so it needs no Suspense boundary at all — move the read behind the hydration check |
| Filter sheet (`FilterSheet`) | Client, mounted with the catalogue | Defer the sheet's contents until it is opened; the trigger button is the only thing needed at paint |
| Finder quiz | Client component on `/finder` | The empty quiz shell is already light; keep the result-mode data read behind the answer submission |
| String recommender | Client, on string detail | Mount on approach, same pattern as similar rackets |
| Price history sparklines (home, deals) | Rendered inline | Server-render the SVG; they are static paths, not interactive charts |
| Below-fold catalogue rows | Full layout cost | `content-visibility: auto` with `contain-intrinsic-size`, **gated** — see Phase 9 |
| Account menu | Streams behind Suspense | Phase 2.3 removes the network call for anonymous visitors; the boundary stays |
| Language switcher | Client leaf in the chrome | Keep; it is already a leaf after Phase 7.1 |

Two rules for anything added later: a lazy boundary must reserve its final box so CLS
stays at 0, and it must have a visible non-JS state — a deferred component that never
mounts because a script failed is a downgrade, not an optimization.

---

### Phase 9 — CSS and render work, only after Phases 1–8

The stylesheet is measurable but it is the twelfth-largest cause, not the first.

1. Use coverage and the Turbopack analyzer to find genuinely unused global/component
   CSS in the 533-line `globals.css`.
2. Move route-specific rules out of the shared critical stylesheet where ownership stays
   clear.
3. Test, do not assume, whether CSS inlining improves the mobile median; reject it if
   the larger HTML/RSC payload or the loss of cross-route stylesheet caching loses
   overall. On a multi-page browsing site, a cached shared stylesheet usually wins after
   the first page.
4. `content-visibility: auto` with `contain-intrinsic-size` on long below-fold sections,
   **only if all four checks pass**: find-in-page still reaches the content; in-page
   anchors and `scroll-mt` still land correctly; the accessibility tree still exposes
   the section; no CLS is introduced when a section is scrolled into range. Any failure
   drops the technique for that section. Never apply it above the fold.

**Exit:** render-blocking time improves without increasing transfer, CLS, or
accessibility failures. Drop the phase if measured savings are negligible.

---

## No-downgrade guarantees

The gate every phase is held to, in addition to its own exit criteria. A phase that
fails any line does not ship, regardless of what it improved.

| Guarantee | How it is checked |
| --- | --- |
| No route moves `◐` → `ƒ` | `npm run build` route table, diffed against the baseline, in CI |
| Prerendered page count does not fall | `PRERENDERED_RACKETS` and the build's page count, asserted in the workflow |
| No feature is removed | Manual route walk per cohort, both locales, mobile and desktop widths |
| Navigation is not slower | Click-to-render measured on the catalogue → detail path before and after, same device profile |
| No visual change without sign-off | Bilingual screenshot pair per touched route; font and CSS phases require it |
| No new CLS | CLS stays at 0 in the lab matrix; every lazy boundary reserves its box |
| Vietnamese never regresses | Codepoint test (Phase 4.4); longest-string layout check, not representative strings |
| Data semantics are identical | Seed-vs-Supabase equivalence check for every changed read; existing repository tests pass |
| Court Score stays one definition | `src/lib/court-score.ts` remains the only implementation; `assertBalanceBands()` still guards the view |
| Security posture is unchanged | No auth decision moves to a cookie-presence check; RLS untouched; Phase 2's optimistic read is display-only and covered by a test |
| Every change is revertible in one step | One commit per phase, no schema migration required by Phases 1, 2, 4, 5, 7, 8, 9; Vercel Instant Rollback available for all |

Phases 3B and 6 are the only two that touch stored data, and both are additive: a new
projection table and new image renditions. Neither drops a column or rewrites an
existing row, so their rollback is "stop reading the new thing".

---

## Public rollout cohorts

| Order | Cohort | Route templates |
| ---: | --- | --- |
| 1 | Homepage | `/[locale]` |
| 2 | Core discovery | `/rackets`, `/rackets/[brand]/[model]`, `/deals`, `/compare`, `/finder` |
| 3 | Public marketplace/content | `/sellers`, `/sellers/[slug]`, `/strings`, `/strings/[brand]/[model]`, `/guides`, `/methodology` |
| 4 | Public auth entry | `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` |

Phases 1 and 2 are app-wide and land before cohort 1, because they change the floor
under every route and every later measurement depends on them.

Ship each cohort to a preview, run the same lab matrix including the cold-path protocol,
inspect the request log, then canary to production. Judge field p75 after 7–14 days of
traffic. Do not let a later cohort block a proven earlier one.

---

## Suggested change sequence

1. `perf(vitals): add baselines, route budgets and the cold-path protocol`
2. `perf(platform): pin the function region to the database region`
3. `perf(auth): skip session work for anonymous public requests`
4. `perf(catalogue): remove the whole snapshot from the listing`
5. `perf(home): add task-shaped homepage data and a stored trending projection`
6. `perf(public-data): shape deals, finder, compare, sellers, guides, strings`
7. `perf(cache): warm public routes after deploy and after scrape`
8. `perf(fonts): drop unused weights and subsets, split the preload set`
9. `perf(prefetch): adopt partial prefetching and correct image priority`
10. `perf(images): add responsive card renditions and repair cache metadata`
11. `perf(client): split shared chrome, i18n, compare and progress boundaries`
12. `perf(lazy): defer gallery, filter sheet and recommender mounting`
13. `perf(css): trim measured render-blocking work` — only if still material

Every change carries a before/after request log, a three-run Lighthouse median from a
Southeast Asian vantage point, `npm run typecheck`, `npm run build` with its route
table, and the relevant repository/image tests. Data-read changes additionally need a
seed-vs-Supabase equivalence check and a forced cold-cache run.

---

## Main risks and controls

| Risk | Control |
| --- | --- |
| The region change is blocked by a Hobby restriction or an IP allow-list | Phase 1 verifies both before changing anything; the fallback is the current state, which is the current measured baseline |
| `getClaims()` does not avoid a round trip because the project is on legacy HS256 | Verified in Phase 2.2 before the change; if so the step is a no-op and the cookie short-circuit still delivers most of the win |
| A cookie-presence check is mistaken for an auth decision | It paints a link and nothing else; a test asserts no query is gated by it; `getUser()` stays everywhere data is gated |
| Vietnamese glyphs or typography regress | Codepoint test over real message and catalogue strings; bilingual visual regression before any subset or weight is removed; `swap` retained on all faces |
| Query-shaped reads change ranking or count semantics | Reuse the existing domain mappers; compare seed and Supabase outputs for every changed read before switching callers |
| Partial Prefetching thins a prefetch a route relied on | Adopt per route with `prefetch = 'partial'`, clear the `next dev` instant-navigation insights on each, measure click-to-render, and only then consider the global flag |
| Long image caching serves stale bytes | Content-hashed object paths are already in place: a changed image gets a changed key |
| Image variants recreate transformation quota pressure | Fixed renditions generated in the crawler and served directly; the Hobby allowance stays the binding constraint |
| Client-boundary refactor breaks PPR | The build route table is a hard gate, and every touched route is opened in `next dev`, where some Cache Components errors only surface |
| A fast warm cache hides a bad cold path | Cold and warm profiles recorded separately; Phase 3D makes the cold path rare rather than letting the warm number speak for it |
| Cache warming masks a slow read instead of fixing it | Warming lands only after 3A–3C; the uncached-transfer and round-trip budgets still apply to every route |

---

## Sources consulted

- Next.js 16.3.1 bundled documentation in `node_modules/next/dist/docs/`, specifically:
  `01-directives/use-cache.md`, `use-cache-remote.md`,
  `02-guides/adopting-partial-prefetching.md`, `runtime-prefetching.md`,
  `03-file-conventions/02-route-segment-config/prefetch.md` and `preferredRegion.md`,
  `02-components/image.md`, `02-components/link.md`,
  `05-config/01-next-config-js/staleTimes.md`.
- `next/dist/compiled/@next/font/dist/google/font-data.json` — the source for the
  Be Vietnam Pro variable-font correction.
- This repository: `next.config.ts`, `src/proxy.ts`, `src/lib/supabase/*`,
  `src/lib/data/repository.ts`, `src/lib/data/catalog-page.ts`, `src/app/fonts.ts`,
  `src/app/[locale]/layout.tsx`, `src/components/auth-slot.tsx`,
  `src/components/racket-card-view.tsx`, `.github/workflows/deploy-production.yml`,
  `.env`.
- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Google's Web Vitals thresholds](https://web.dev/articles/vitals)
- [Vercel Functions regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Supabase Storage optimizations](https://supabase.com/docs/guides/storage/production/scaling)
- [Supabase Storage CDN fundamentals](https://supabase.com/docs/guides/storage/cdn/fundamentals)
- [Supabase `getClaims` and asymmetric JWTs](https://supabase.com/docs/guides/auth/signing-keys)
