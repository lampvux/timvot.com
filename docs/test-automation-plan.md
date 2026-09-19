# Test automation plan

> **Status: implemented.** Every phase below shipped. What the plan predicted
> and what actually happened differ in a few places, and those differences are
> recorded at the bottom under [What shipped](#what-shipped) — including the
> seven real defects the suite found while it was being written, and the one
> piece that has not yet run against a live database.


Shuttlecraft already has real test automation. What it does not have is a
**gate**: nothing runs on a pull request. `test:lib`, `test:string-scraper`,
`test:catalogue` and `test:supabase-migration` are never executed by CI at all,
and `test:scraper` / `test:image-scraper` run only inside the nightly scraper
job — hours after the code that broke them was merged.

So this plan is mostly not about writing a test framework. It is about (1)
closing that gate, (2) extending three patterns the repo already invented, and
(3) adding exactly one new runner for the one layer that genuinely has none.

The guiding constraint: **reuse first**. Every phase below names the existing
script, test file or workflow it extends. New dependencies are held to three,
and one of them is already installed.

---

## 1. What already exists

### Runners and gates

| Asset | What it covers | Runs in CI? |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src/` + `scripts/` (excludes `admin/`) | deploy-production only |
| `admin: npm run typecheck` / `npm run lint` | the admin app; the only ESLint in the repo | deploy-admin only |
| `npm run test:lib` | `src/lib/*.test.ts`, `src/lib/**/*.test.ts`, `src/i18n/*.test.ts` | **never** |
| `npm run test:scraper` | guard, http, report, vs-specs, woocommerce | nightly only |
| `npm run test:image-scraper` | 12 suites: discover, gallery, match/merge, ownership, reconcile, per-provider | nightly only |
| `npm run test:string-scraper` | string catalogue | **never** |
| `npm run test:catalogue` | `duplicate-rackets` | **never** |
| `npm run test:supabase-migration` | project-migration script | **never** |
| `admin: npm test` | `admin/src/lib/*.test.ts` | **never** |

All of it is `tsx --test` over `node:test` — no framework, no config, no
transform step. That is the house style and this plan does not change it.

### Measurement scripts (already written, already good)

- **`scripts/benchmark.ts`** — three layers (`sql` / `postgrest` / `js`) across
  `snapshot:`, `detail:`, `catalogue:`, `deals:` scenarios, with `today` vs
  `proposed` rows. Has `--runs`, `--only`, `--explain`, `--markdown`, **`--json`**.
- **`scripts/warm-routes.ts`** — requests every public route in both locales,
  prints cold TTFB per route, has **`--strict`** and `--markdown`.
- **`scripts/audit-font-glyphs.ts`**, **`scripts/scraper/images/audit.ts`**,
  **`scripts/scraper/images/reconcile.ts`**, **`scripts/duplicate-rackets.ts`**,
  **`scripts/score-report.ts`**, **`scripts/migrate.ts --dry-run`** — six audits
  that already produce a verdict nobody asserts on.

### Patterns worth copying rather than reinventing

1. **`src/lib/data/read-path.test.ts`** — source-level assertions. It reads
   `page.tsx` as text and fails if the import list contains a whole-catalogue
   read. This is the cheapest guardrail in the repo: it catches an architectural
   regression in milliseconds, with no database, no render and no browser. Most
   of CLAUDE.md's "Performance rules the code enforces" section is *prose that
   nothing enforces*; this pattern is how it becomes enforcement.

2. **`.github/workflows/daily-scraper.yml`** — `continue-on-error` per step,
   `steps.<id>.outcome` collected, one final **Report Step Outcomes** step that
   owns the verdict. That is exactly the shape a multi-axis test job needs, where
   a flaky axe scan must not hide a failing unit suite.

3. **`src/lib/data/seed.ts` as a zero-config fixture.** `npm run dev` runs with
   no env vars at all, and the repository returns the same shapes from the seed
   as from Supabase. **This is the single most important asset in the plan**: it
   means end-to-end tests need no database, no secrets, no seeding step and no
   network — and they are deterministic, because the seed is a committed file.

4. **`playwright` is already a devDependency** (used by `scraper/verify.ts` and
   `images/browser.ts`), and CI already knows how to install Chromium.

---

## 2. What is missing

Mapped to the four axes the brief names.

**Functionality.** No tests for `court-score.ts` (the published product claim),
`finder.ts`, `format.ts`, `mappers.ts`, `catalog-page.ts` or
`racket-detail-profile.ts`. `price-window` is covered, but `auth-actions`,
`seller-actions`, `seller-listing-actions` and `profile-actions` are not. No test
asserts `messages/vi.json` and `messages/en.json` agree. Nothing renders a single
page.

**UI/UX.** Zero. No component tests, no E2E, no accessibility scan, no
responsive check, no visual assertion. Every rule in "Design rules the code
enforces" — no emoji, no exclamation marks, prices never abbreviated, stock
thresholds, hairline-not-shadow, the fixed 280–305 mm Balance Ruler, Vietnamese
running 20–30% longer — is enforced only by review.

**Performance.** `benchmark.ts` and `warm-routes.ts` measure beautifully and
assert nothing. No baseline is committed, so no run can be compared to the last
one. The route table (○ vs ƒ, First Load JS) is read by a human "before calling
a change done", and the Cache Components dev-only validation is checked by a
human opening `next dev`. Both are automatable.

**Security.** `safeNext` is exported and documented as the open-redirect fix and
has no test. The `/api/revalidate` constant-time comparison has no test. RLS is
"on for every table" with a large policy surface across 16 migrations, and no
policy is exercised by anything. Nothing checks that a service-role key never
reaches a client bundle. No dependency audit. No security headers are configured
in `next.config.ts` at all.

---

## 3. Shape of the plan

One gate, five layers, in ascending cost:

```
  ci.yml (pull_request + push:main)
    ├── static     typecheck root + admin, admin lint            ~1 min
    ├── unit       npm test  ->  every node:test suite, no env   ~1 min
    ├── guardrail  source-level architecture/design assertions   (inside unit)
    ├── build      next build + route-table budget               ~4 min
    ├── e2e        Playwright on the built app, seed fallback,    ~5 min
    │              vi + en, axe, 400px, design-rule assertions
    ├── perf       benchmark budgets (nightly), warm --strict     (post-deploy)
    └── security   audit, bundle secret scan, RLS policy suite   ~3 min
```

New dependencies, total: **`@playwright/test`** (the runner; `playwright`
itself is already installed), **`@axe-core/playwright`**, and optionally
**`@lhci/cli`** in Phase 4. Nothing else.

---

## Phase 0 — Close the gate (half a day)

Nothing below matters until a pull request runs something.

**0.1 Aggregate script.** `package.json`:

```json
"test": "npm run test:lib && npm run test:scraper && npm run test:image-scraper && npm run test:string-scraper && npm run test:catalogue && npm run test:supabase-migration",
"test:e2e": "playwright test",
"test:security": "tsx --test scripts/security/*.test.ts"
```

`npm test` must run with **no environment variables**, the same promise
`npm run dev` makes. Any suite that needs Postgres belongs in `test:security`
or the nightly perf job, not here.

**0.2 `.github/workflows/ci.yml`.** Jobs `static`, `unit`, `build`, `e2e`,
`security`. Copy the outcome-collection pattern from `daily-scraper.yml` so an
advisory step (axe on a new page, `npm audit` on a fresh advisory) reports
without masking a hard failure — and so the summary names *which* axis broke.

**0.3 Demote the nightly's test duty.** Once `ci.yml` runs `test:scraper` and
`test:image-scraper` on every PR, the nightly's copies become a smoke check of
the runner, not the gate. Keep them — they cost seconds, and the nightly is where
dependency drift first shows — but stop treating them as coverage.

**Exit:** a PR that breaks `filters.test.ts` fails before review.

---

## Phase 1 — Functional unit and contract tests (2–3 days)

All `tsx --test`, all colocated next to the module, all following the existing
file style: a doc comment naming *the claim under test*, then `node:test`.

| New file | Claim under test |
|---|---|
| `src/lib/court-score.test.ts` | 50/50 spec-vs-player split; tier weights 3x/2x/1x; **under five verified reviews `courtScore` is `null`** and the spec half is never substituted; score is stable for a fixed input (the golden case that makes a coefficient change *visible* in a diff) |
| `src/lib/finder.test.ts` | every Finder input maps to a filter; no input combination returns an unhandled shape; an empty result carries the "what to do next, with a number" payload |
| `src/lib/format.test.ts` | `₫3.290.000` never abbreviates; deltas carry sign, window and **U+2212**; stock renders exact to 10, then `10+`, and `3 left` below 4; `balanceTypeOf` agrees with `types.ts` bands |
| `src/lib/data/mappers.test.ts` | snake_case ↔ camelCase round-trip; `_en`/`_vi` columns fold into `{ en, vi }`; **`RACKET_SELECT` names every column the mappers read** (the drift this file is designed to have) |
| `src/lib/data/catalog-page.test.ts` | each filter in `SEARCH_KEYS` resolves to a predicate on `racket_market`; sort keys map to orderings; the **degraded in-memory mode** returns the same page shape as the view, and is entered on a query error rather than throwing |
| `src/lib/racket-detail-profile.test.ts` | profile assembly from a snapshot; missing gallery / missing reviews / single-offer cases |
| `src/lib/auth-actions.test.ts` | `signInWithProvider` **re-checks the provider against the server-side list** and refuses one absent from `NEXT_PUBLIC_AUTH_PROVIDERS`; a null Supabase client is a handled branch, not a crash |
| `src/lib/seller-listing-actions.test.ts` | an offer attaches to a catalogued variant; a seller cannot set its own tier |
| `src/i18n/message-parity.test.ts` | `vi.json` and `en.json` have identical key sets **and identical ICU placeholder sets per key** — a `{count}` present in one locale only is a runtime throw in the other |
| `src/lib/data/seed-drift.test.ts` | regenerating `supabase/seed.sql` from `seed.ts` into a temp file byte-matches the committed one (CLAUDE.md's "generated, not edited twice", enforced) |

`price-window.test.ts`, `catalog-ranking.test.ts`, `filters.test.ts`,
`font-subsets.test.ts`, `auth-cookie.test.ts` and `client-namespaces.test.ts`
stay as they are — they are the model these follow.

**Fixtures:** none. `src/lib/data/seed.ts` is the fixture; import it. A second
fixture set would desynchronise from the no-database fallback exactly the way a
hand-edited `seed.sql` does.

---

## Phase 2 — Guardrail tests (1–2 days, highest value per hour)

Extend the `read-path.test.ts` pattern into `src/lib/guardrails/`. These read
source as text and assert on it. They are fast, need nothing, and they turn
CLAUDE.md's rules into failures instead of review comments.

Move the existing `read-path.test.ts` there unchanged, then add:

- **`select-all.test.ts`** — every `.select(` in `repository.ts` and
  `string-repository.ts` is reached through `selectAll`, and every `selectAll`
  call carries a unique `.order()`. This is the 1000-row silent-truncation bug;
  five of seven tables are over the cap.
- **`layout-purity.test.ts`** — `src/app/[locale]/layout.tsx` contains no
  `cookies()`, `headers()`, `searchParams` or `getUser()`. One of those opts the
  whole app out of prerendering.
- **`client-boundary.test.ts`** — no file with `"use client"` imports
  `@/lib/data/repository`; no file imports `{ icons }` from `lucide-react`; no
  client file calls `usePathname` / `useSearchParams` / `useParams` /
  `useSelectedLayoutSegment` outside a `<Suspense>` boundary or a
  post-hydration branch.
- **`suspense-coverage.test.ts`** — every `page.tsx` that awaits data has a
  sibling `loading.tsx` or a `<Suspense>` in its tree.
- **`court-score-purity.test.ts`** — `court-score.ts`'s import list and
  identifier set contain no `offer`, `price`, `seller`, `promotion` or `msrp`.
  This is the published product claim on `/methodology`; it deserves a test that
  fails loudly, not a comment.
- **`methodology-sync.test.ts`** — the coefficients in `court-score.ts` appear
  verbatim in the `/methodology` page copy. A coefficient change that does not
  reach the published page is a false claim.
- **`balance-bands.test.ts`** — call the existing `assertBalanceBands()` from a
  test rather than only at runtime.
- **`design-rules.test.ts`** — scan `messages/{vi,en}.json` and
  `src/components/` for emoji, `!`, and abbreviated-price patterns
  (`₫\d+(\.\d+)?M`). Sentence case except eyebrows. Mechanical, and currently
  unenforced.

All of these run inside `npm run test:lib`, so Phase 0's gate picks them up for
free.

---

## Phase 3 — UI/UX end-to-end and accessibility (4–5 days)

**The unlock:** build and serve with the Supabase env vars *cleared*. The
repository falls back to `seed.ts`, so the app under test is deterministic,
offline, and identical on every machine — no fixtures to maintain, no database to
provision, no secret in CI.

**3.1 `playwright.config.ts`** (new; `@playwright/test` is the only new runner):

- `webServer`: `next build && next start`, with `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` unset.
- projects: `chromium-desktop` (1280) and `chromium-mobile` (**400px**, the width
  CLAUDE.md names), each run under `/vi` and `/en`. Vietnamese is the default
  locale and runs 20–30% longer; both must pass.
- a second `dev` project (3.5 below) against `next dev`, because "`npm run build`
  passing is not enough for a caching change".

**3.2 Specs** — `e2e/`, one file per surface:

| Spec | Asserts |
|---|---|
| `catalogue.spec.ts` | filters and sort live **in the URL**; a pasted filtered URL renders server-side and identically; pagination is a `page` key, 24 cards per page, no infinite scroll; facet counts match the rendered set; the empty state names a number |
| `racket-detail.spec.ts` | spec labels render as eyebrow/tertiary and values as mono/primary; the Balance Ruler uses the fixed 280–305 mm rule; under five reviews the page says "spec profile only" and shows no total; the gallery falls back without putting a client boundary on the card |
| `compare.spec.ts` | tray add/remove persists; comparison markers share one rule; **no radar chart exists anywhere** |
| `finder.spec.ts` | the quiz completes to a result set, and the result is a normal filtered catalogue URL |
| `strings.spec.ts`, `deals.spec.ts`, `sellers.spec.ts` | list → detail, pagination, empty states |
| `i18n.spec.ts` | the language switcher preserves path **and query**; model names and spec codes are **not** translated; no control is clipped at 400px in `vi` |
| `auth.spec.ts` | browsing, comparing and the Finder need no account; watchlist / alerts / reviews prompt sign-in; OAuth buttons render only the providers in `NEXT_PUBLIC_AUTH_PROVIDERS`; `/auth/callback` is reachable **unprefixed** (the 404 regression CLAUDE.md warns about) |
| `chrome.spec.ts` | site chrome is in the static shell — links present and clickable before hydration; only the active highlight streams |

**3.3 Accessibility** — `@axe-core/playwright`, run as a shared fixture on every
page a spec visits rather than as its own spec. Fail on `serious` and `critical`;
report `moderate`. Plus an explicit assertion for the design system's own rule:
**status is always colour *and* icon *and* a value** — a status pill with colour
alone is an accessibility failure this codebase has already decided against.

**3.4 Layout integrity** — at 400px, assert
`document.scrollingElement.scrollWidth <= clientWidth` on every route in both
locales. The single cheapest catch for the Vietnamese-length rule.

**3.5 Dev-mode smoke** — a Playwright project against `next dev` that opens every
route and fails on a Next.js error overlay. Cache Components validation runs only
in development; this is the automated form of "start `next dev` and open the
routes you touched before calling it done".

---

## Phase 4 — Performance budgets (2–3 days)

No new measurement code. Both scripts already print the numbers; they need a
baseline and a verdict.

**4.1 `perf/baseline.json`** — committed output of `npm run benchmark -- --json`.

**4.2 `scripts/perf-budget.ts`** (new, ~120 lines) — reads a fresh `--json` run
and the baseline, and exits non-zero on a regression beyond tolerance. Two rules
the repo's own notes demand:

- **Subtract `baseline:round trip` before comparing any `sql` row.** From a
  laptop that row is most of every SQL number; comparing raw totals across
  machines produces noise, not signal.
- Budget per *scenario group*, not per scenario. `catalogue:` is the group with
  the ~9.3 s → ~5 ms history and the one worth a hard ceiling.

Runs nightly (it needs a database), not per PR.

**4.3 `scripts/route-report.ts`** (new, ~100 lines) — parse `next build` output
and fail when a route moves ○ → ƒ, when First Load JS rises past a committed
budget, or when the prerendered page count crosses the worker ceiling
(`pages_per_worker_limit × NEXT_BUILD_CPUS`). CLAUDE.md asks a human to read this
table on every change; a script reads it identically and never forgets.

**4.4 `warm-routes.ts --strict`** as its own post-deploy job. It is already wired
into `deploy-production.yml` as `continue-on-error` — keep that for the deploy,
and add the strict job separately, so a slow route is reported without failing an
otherwise healthy release. That split is exactly what the script's own doc
comment anticipates.

**4.5 Core Web Vitals** — `@lhci/cli` against the Phase 3 `next start` server on
`/vi/rackets` and one racket detail page. LCP / CLS / TBT budgets only. Optional;
skip it if the axe and route-table coverage is judged enough.

---

## Phase 5 — Security (3–4 days)

**5.1 Pure unit, no infrastructure** (runs inside `npm test`):

- **`safeNext`** — already exported from `auth/callback/route.ts`. Table-drive
  it: `//evil.example`, `/\evil.example`, `https://evil.example`, backslash and
  percent-encoded variants, empty, `null`. Each must fall back to
  `/${locale}/account`.
- **`/api/revalidate`** — 401 for no header, for a wrong secret, and for **no
  secret configured** (all three indistinguishable from outside); 400 for an
  unknown tag; equal-length-then-constant-time comparison; a valid call
  revalidates exactly `SCRAPE_TAGS`.
- **Locale validation** in the callback — an unlisted `locale` param falls back
  to the default rather than reaching a redirect.
- **`scripts/scraper/robots.ts`** — the scrapers fetch attacker-influenced URLs.
  Assert robots compliance, and that no scheme other than `http(s)` and no
  loopback or private host is followed.

**5.2 Bundle and source scan** (`scripts/security/leak.test.ts`):

- No `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `DIRECT_URL` or
  `REVALIDATE_SECRET` identifier appears in any file reachable from a
  `"use client"` module.
- After `next build`, grep `.next/static/**` for the *values* of those vars —
  the only check that catches an accidental `NEXT_PUBLIC_` rename.
- `scripts/` is never imported from `src/` (the node-only boundary CLAUDE.md
  states, currently unenforced).

**5.3 RLS policy suite** (`scripts/security/rls.test.ts`) — the largest new
piece, and the one covering the claim with the most surface: 16 migrations of
policies that nothing exercises.

- Brought up with `supabase start` locally and in CI, migrated to head with the
  **existing `scripts/migrate.ts`** and seeded with the **existing
  `npm run seed:db`**. No new provisioning code.
- Three clients — anon, an authenticated non-seller, an authenticated seller —
  then assert:
  - anon cannot insert, update or delete `rackets`, `variants`, `racket_images`
  - a seller can write **its own** offers and cannot write another seller's
  - a seller **cannot change its own tier** (the escalation this schema exists to
    prevent)
  - a seller cannot create a product, only attach an offer to a catalogued
    variant
  - watchlists and price alerts are readable only by their owner
  - `racket-images%` buckets are public-read and admin-write
  - the image-ownership trigger refuses a path whose slug does not match its
    owner
- Runs in its own CI job with a Postgres service container, not in `npm test`.

**5.4 Supply chain** — `npm audit --audit-level=high` for root and `admin/`,
advisory (outcome-collected, per the nightly's pattern), plus `npm ci` lockfile
integrity, hard.

**5.5 Security headers** — there are none in `next.config.ts` today. Add
`Content-Security-Policy`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, `Strict-Transport-Security` and a
`Permissions-Policy`, then a Playwright spec asserting each on a prerendered
route and a dynamic one. The CSP must allow the Supabase storage hosts already
listed in `images.remotePatterns`, plus Vercel Analytics and Speed Insights.
*This is a code change, not only a test — flagged here because the test is what
keeps it from silently regressing.*

---

## 4. CI wiring

`.github/workflows/ci.yml`, on `pull_request` and `push: main`:

| Job | Steps | Needs secrets | Hard fail |
|---|---|---|---|
| `static` | `npm ci`; `npm run typecheck`; admin typecheck + lint | no | yes |
| `unit` | `npm ci`; `npm test` (Phases 1, 2, 5.1, 5.2 source half) | **no** | yes |
| `build` | `next build`; `scripts/route-report.ts`; upload `.next` | no | yes |
| `e2e` | download `.next`; `playwright install chromium`; `npm run test:e2e` (seed fallback, vi + en, 1280 + 400, axe) | no | yes, except axe `moderate` |
| `security` | postgres service; `migrate`; `seed:db`; RLS suite; bundle grep; `npm audit` | local only | yes, except `audit` |

Nightly, extending `daily-scraper.yml` rather than adding a workflow:
`benchmark --json` into `perf-budget.ts`, plus `images:audit`, `images:reconcile`,
`catalogue:dupes` and `score-report` — the audits that already exist and
currently print into a log nobody reads. Each gets a step id and lands in the
existing **Report Step Outcomes** summary.

Post-deploy: `warm-routes --strict` as its own job.

**Concurrency and cost.** `static` and `unit` are under two minutes and gate the
rest; `build` hands `e2e` its artifact so the app compiles once. The whole PR
gate should land inside ten minutes.

---

## 5. Sequencing and effort

| Phase | Effort | Unblocks |
|---|---|---|
| 0 — the gate | 0.5 d | everything |
| 2 — guardrails | 1–2 d | do this **before** Phase 1: cheapest, and it protects the rules most likely to regress |
| 1 — functional units | 2–3 d | Court Score, Finder, mappers, i18n parity |
| 5.1 + 5.2 — security units and scans | 1 d | open redirect, revalidate auth, key leakage |
| 3 — E2E, a11y, responsive | 4–5 d | every UI/UX claim |
| 4 — perf budgets | 2–3 d | regression detection |
| 5.3–5.5 — RLS, audit, headers | 2–3 d | the security claim end to end |

Roughly **13–18 working days**, and the first half day delivers most of the
immediate risk reduction, because it makes 28 existing test files load-bearing.

---

## 6. Exit criteria

- A pull request runs typecheck, every unit and guardrail suite, a build with a
  route-table verdict, E2E in both locales at two widths with axe, and the
  security scans — and fails before review when any of them regress.
- Every rule in CLAUDE.md's "Performance rules the code enforces" and "Design
  rules the code enforces" has either a guardrail test or an E2E assertion. A
  rule with neither is either enforced or deleted from the document.
- `court-score.ts` cannot read commercial data, and its coefficients cannot
  diverge from `/methodology`, without a test failing.
- A `.select()` without `selectAll`, an `icons` barrel import, a `cookies()` in
  the locale layout, or a client boundary on a container fails CI.
- Anon cannot write the catalogue, and a seller cannot raise its own tier — in a
  test, rather than in a policy file.
- `benchmark` and `warm-routes` compare against a committed baseline instead of
  printing a number into a log.

## 7. Explicitly out of scope

Matching the "Not built" list: payments, order capture, seller application flow,
admin moderation, review submission, `/vs/[a]-vs-[b]`, guide bodies and dark mode
get no tests, because they do not exist. Load testing is out of scope — Hobby
rations Active CPU, and `warm-routes.ts` documents that it is warming a cache,
not load-testing. Cross-browser beyond Chromium is deferred until the Chromium
suite is green and stable.

---

# What shipped

Written after the fact, against the plan above. The structure survived; several
details did not, and the differences are the useful part.

## The numbers

| | |
|---|---|
| node:test assertions | **382** across 7 suites, from 29 before |
| Playwright tests | **303** (2 locales × 2 widths) + **29** dev-mode smoke |
| RLS policy tests | **34**, in their own runner with a Postgres service |
| New guardrail files | 8, in `src/lib/guardrails/` |
| New dependencies | 3: `@playwright/test`, `@axe-core/playwright`, `server-only` |
| Gate runtime | ~10 min across 6 parallel CI jobs |

`@lhci/cli` was **not** added: the axe fixture plus `route-report.ts` cover the
ground it would have, and a fourth dependency for a second opinion on LCP was
not worth it. `server-only` was not predicted — it turned out to be needed
before any app module could be imported from a node test at all (see below).

## Defects the suite found

Seven, all fixed in the same change except where noted. Each is the reason the
test that found it exists.

1. **A hydration mismatch on every racket detail page.** `ReviewDate` rendered
   a *relative* date on the server. These pages are prerendered at build time
   and read days later, so the server's text and the browser's could never
   match; React discarded the server HTML for the surrounding subtree and
   re-rendered the whole review list client-side, logging
   `Minified React error #418` on every load. Found by the console-error
   fixture, which exists precisely because a hydration mismatch does not look
   like anything on a screenshot.

2. **The language switcher dropped the query string.** Switching locale on
   `/vi/rackets?brand=yonex&sort=price-asc` landed on `/en/rackets` — filters,
   sort and page gone. Filters live in the URL so a view survives being shared;
   the switcher was the one control that threw them away.

3. **`seed.ts` was not reproducible across timezones.** The offer `updatedAt`
   used `new Date(y, m, d)`, which builds in local time and serialises as UTC,
   so `npm run seed:sql` produced a different `supabase/seed.sql` in Hanoi than
   in CI — 73 lines of diff, every time, for no change. Price history and
   reviews already used `Date.UTC`; this one was the outlier. Fixing it was a
   precondition for the drift test being able to say anything at all.

4. **`/methodology` published a stale review threshold.** The page passed
   `{ count: MIN_REVIEWS_FOR_PLAYER_SCORE }` to a message that spelled "5"
   instead of interpolating it. `t(key, { count })` against such a message
   ignores the argument silently, so raising the threshold would have left both
   locales publishing the old one — on the page whose whole purpose is being
   checkable.

5. **The racket detail page did it twice more.** `racket.specOnlyNote` had the
   same shape, in both locales, at both call sites.

6. **The catalogue's sort control had no accessible name below `sm`.** Its
   visible label is `hidden sm:inline`, so on mobile the wrapping `<label>`
   contributed nothing and the control reached a screen reader as an unnamed
   `<select>`. Critical, and invisible at desktop width — which is why two
   viewports rather than one.

7. **`<dl>` rows on `/methodology` were not `dt`/`dd`.** `SpecRow` rendered two
   `<span>`s, so the pairing between each label and its value was lost for a
   screen reader — and on that page the pairs *are* the content.

Full detail, including the one finding not fixed, in
[`accessibility-findings.md`](accessibility-findings.md).

## Where the plan was wrong

**The E2E suite cannot assert 404 status codes.** The plan assumed an unknown
racket answers `404`. Under Cache Components an unlisted path serves its App
Shell immediately, so `notFound()` runs after the response has been flushed and
cannot change the status line. The specs assert what a visitor actually gets —
the not-found state and a route back — with the reason written beside them.

**`networkidle` is unusable here.** The Vercel Analytics scripts 404 outside a
deployment and retry, so the network never goes quiet. Every wait is either
`load` plus a settled-count poll (`countCards`) or an explicit locator wait.

**Server modules could not be imported from node at all.** `server-only` throws
from its default entry by design and is only importable under the
`react-server` export condition, and it was not installed at the root at all —
Next aliases it internally. So `test:security` runs
`tsx --conditions=react-server`, and `server-only` is now a devDependency.
Without both, `safeNext` and the revalidate route could not be unit-tested.

**A `"use server"` module is a boundary, not an import.** The first version of
the client-reachability scan walked *through* Server Actions and reported every
sign-in form as leaking the Supabase server client. Correct-looking, completely
wrong, and exactly the kind of false positive that gets a security test deleted.

**The dev smoke has to run with one worker.** `next dev`'s `use cache` store is
a set of files it writes and re-reads per request; several Playwright workers
hitting it at once corrupt them, and the server answers 500 with a `JSON.parse`
error from inside Next on routes that serve fine one at a time and in
production. It is a check that every route compiles, not a load test.

**Three hard rules had to become self-cleaning allowlists**, because enforcing
them outright would have made the suite red on day one and therefore ignored.
Each fails both when something new is added to it *and* when an entry stops
being needed, so the debt is named rather than hidden and cannot outlive its
reason:

- `KNOWN_UNPAGED` in `select-all.test.ts` — `string-repository.ts` reads three
  growable tables with no paging at all.
- `NO_BOUNDARY_TODAY` in `suspense-coverage.test.ts` — six data-reading routes
  with no loading state, all currently prerendered, none guaranteed to stay so.
- `KNOWN_VIOLATIONS` in `e2e/fixtures.ts` — the `color-contrast` token ramp.

## What has not been verified

**The RLS suite has never run against a database.** It is written, typechecks,
and skips cleanly without `RLS_DATABASE_URL`; there was no Docker daemon or
local Postgres on the machine it was written on. Its first real execution will
be the `security` job in `ci.yml`, and the harness — a bootstrap that shims
`auth.uid()`, the three Supabase roles and `auth.users` into a plain
`postgres:17` — is the part most likely to need a correction on that first run.

**The nightly performance budget has not run against the real catalogue.**
`perf-budget.ts` is exercised against synthetic runs (including a deliberate
regression, which it catches and exits 1 on), but `perf/benchmark-baseline.json`
does not exist yet: it has to be written from a real nightly run, because a
baseline taken from a laptop would encode this laptop's latency. The first
nightly prints the table and says there is no baseline; someone then commits
one. `perf/route-baseline.json` **is** committed, from a real build.
