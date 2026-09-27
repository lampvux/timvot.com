# Facebook-first racket buying: engineering plan and AI-native SDLC

**Status:** Draft for product and engineering review  
**Date:** 27 September 2026  
**Audience:** Product owner, frontend and backend engineers, data/content owners, and QA  
**Related documents:** [Vietnamese engineering plan](facebook-first-engineering-plan.vi.md) · [Vietnamese buyer strategy](facebook-first-buyer-strategy.vi.md)  
**Process reference:** [The AI-Native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)

This is the English version of the Facebook-first engineering plan, with a delivery process adapted from the referenced AI-native SDLC playbook. It describes work for the existing Next.js 16 and Supabase application. Buyers can **find a racket, check a listing, compare options, and inspect the evidence for free**. The first release works without sign-in and without automatically reading Facebook posts.

## 1. Buyer outcome and release scope

A player who sees a racket listing in a Facebook group should be able to open Timvot on a phone, enter the racket name, asking price, and condition, and get three answers:

1. **Does this racket suit me?** Explain the reasons and tradeoffs.
2. **What can we actually say about the price?** Show comparable evidence, its variant and condition, when it was observed, and where evidence is insufficient.
3. **What should I do next?** Suggest questions or photos to request, useful alternatives, and a path back to the original listing.

The home page should offer three paths: **Check a listing I found**, **Find a suitable racket**, and **Compare rackets**. A transaction can still happen through Facebook/Messenger or a retailer. Design for a first useful result in roughly one minute, then validate that timing with real users before making a public promise.

### Release levels

| Level | Included | Entry condition |
| --- | --- | --- |
| **P0 — first release** | Manual listing input; model and variant confirmation; fit and tradeoffs; price context with source and confidence; used-racket inspection checklist; comparison and safe sharing; three home-page paths. | No buyer account or new service required. Do not store Facebook posts or personal photos on the server. |
| **P1 — after validation** | Moderated, condition-matched used-racket observations; easier saving and sharing; result feedback; optional questions about the racket currently used and improvement goals. | Real buyer demand, a moderation owner, and enough data coverage. |
| **P2 — after evidence of demand** | Curated review videos, opt-in photo recognition/OCR, broader Q&A, and tools for group admins or sellers. | Demonstrated benefit over manual input, plus content and privacy operations. |

P0 is a decision aid for buyers. A new classifieds marketplace, payment flow, private-group scraper, or general-purpose chatbot is outside this release.

## 2. Current codebase and gaps

| Existing capability | Reuse | Gap to close |
| --- | --- | --- |
| `src/lib/finder.ts`, `/[locale]/finder`, `FinderQuiz` | Questions, ranking, and fit explanations. | No path from a racket the buyer already found; limited tradeoff explanation or release-year preference. Finder currently displays `lowestPrice ?? msrp`, which can make list price look like a current offer. |
| `rackets`, `racket_variants`, `racket_market`, catalogue lookup | Canonical models, brands, variants, and specifications. | Bounded fuzzy lookup and buyer confirmation of the exact model/variant; no full catalogue load per check. |
| `offers`, `price_points`, `getVariantPrice`, `price-window.ts` | Retail offers, offer condition, variant price history. | `price_points` has no condition. `median30` currently means the median of the final third of observations, not a calendar 30-day window. An offer's `updated_at` does not prove the seller recently confirmed stock. |
| `/[locale]/compare`, `CompareProvider` | Comparison and browser-side selection. | Bring the checked listing into comparison, highlight relevant differences, and share only permitted data. |
| Reviews, sellers, watchlist, guides, `next-intl` | Evidence, advice, and two locales. | Used-racket checklist, clear source labels, and `vi`/`en` strings for every new state. |
| Cache Components, Supabase RLS, Playwright | Read-path performance, permissions, and browser tests. | Bounded queries, fast initial shell, and no anonymous write path into trusted price data. |

Relevant source files include `src/lib/types.ts`, `src/lib/data/repository.ts`, `src/lib/data/catalog-page.ts`, `src/lib/price-window.ts`, `src/app/[locale]/finder/page.tsx`, and `supabase/migrations/`. Before a PR changes Next.js code, read the relevant installed guides in `node_modules/next/dist/docs/`, as required by `AGENTS.md`. The project has `cacheComponents: true`.

## 3. Frontend requirements

### 3.1 Home page and entry path

- Add a “How are you looking for a racket?” section with the three paths above. Make **Check a listing I found** the primary mobile action and route to `/vi/check` or `/en/check` according to locale.
- Let someone arriving from a Facebook link enter a model and price on the first screen. Do not require an account or an introductory article.
- Reuse the current visual system and `ds/` components. Use one main action per screen, accessible tap targets, visible focus, and text labels that do not rely on color alone.

### 3.2 Check-listing form (`/[locale]/check`)

| Input | P0 rule | Missing or ambiguous data |
| --- | --- | --- |
| Racket model | Required. Suggest at most eight models with brand, full name, and thumbnail where available. Ask the buyer to select a canonical model or continue as “model unconfirmed.” | Ask for clarification among Play/Tour/Pro, generations, or similarly named models. If absent from the catalogue, offer catalogue search and a way to report the missing model. |
| Variant | Ask for 3U/4U, grip size, and color when known; “not sure” is valid. | Do not present a same-variant price conclusion until variant is known. |
| Asking price | VND number, required for a price assessment; optional when only checking fit. | Validate range and format, reject negative or malformed values, and display `₫` correctly. |
| Condition | `new`, `open-box`, `used`, or `unknown`; no detailed used-grade requirement in P0. | For `used` or `unknown`, show clearly labeled retail reference prices only. Do not judge the asking price as a bargain. |
| Player profile | Two or three minimal questions, or optionally reuse Finder answers already supplied by the buyer. | Show specs and price context first; label fit “needs more about you” if the profile is missing. |

On mobile, group the form into short steps, use a numeric keyboard for price, make suggestions keyboard and screen-reader accessible, place errors next to fields, and preserve input on edit/back navigation. P0 does not require pasting a Facebook URL. If P1 accepts a URL, use it only as a buyer-controlled way back to the post; do not claim to read private-group content. Never put post URLs, seller identities, photos, conversation text, or health information in a share link.

Implement explicit states for lookup in progress, ambiguous match, missing model, no offers, stale evidence, network failure, and partial result. A price-data failure must not hide specifications or the inspection checklist.

### 3.3 Result screen

At 360–390 px width, order the result as: **model and match confidence → fit and tradeoffs → price context → three seller questions → alternatives → detailed comparison**. The main action is **Copy questions for the seller**. Comparison, editing, and retailer offers are secondary actions. Desktop may place price beside fit without making the information depend on a two-column layout.

- **Fit:** “May suit you,” “Worth considering the tradeoffs,” or “Need more about the player.” Show one or two evidence-backed reasons and at least one inferable tradeoff.
- **Price:** “Comparable listings available,” “Retail reference only,” or “Insufficient data.” Do not label a listing a “bargain” or “cheapest” unless Section 5's evidence rules are met.
- **Evidence:** Show eligible sample count, variant, condition, source, and observation date. Separate the buyer-entered asking price from Timvot-collected evidence.
- **Used racket:** Ask for close-up photos of frame, grommets, shaft, and grip; cracks and repairs; exact variant; and an in-person inspection. Do not certify authenticity of an uninspected item.

The P0 share URL may contain only the model/variant IDs, asking price, and condition that the buyer actively chooses to share. Do not automatically share Finder answers. The current Finder URL can contain a shoulder/elbow answer, so new share cards and links must exclude it.

### 3.4 Finder, comparison, and guides

- Keep Finder's initial five questions. After the first result, optionally ask about earliest acceptable release year, current/favorite racket, and goals such as defense, attack, or control. Test with buyers before changing the ranking weights. Explain when a recommended model is older than the stated preference.
- In Finder and cards, distinguish **a current in-stock offer** from **reference MSRP**. When no offer exists, do not show MSRP as a buy-now price. Add a tradeoff line and **Check a listing for this racket** action.
- In comparison, highlight differences relevant to the player's question: weight, balance, stiffness, release year, and actual offer price. Allow the checked racket plus up to two alternatives. Preserve the full technical table for experienced players.
- Add a short “What to ask when buying a used racket” guide. Curated videos belong in P2 and must identify source and whether the speaker is a player, seller, or sponsor.

## 4. Backend and data contracts

### 4.1 P0 flow without storing Facebook listings

1. Make `/[locale]/check` a Server Component page with a fast shell. Put `searchParams` and request-specific data behind `Suspense`, following the installed Next.js guidance and the existing Finder pattern; installed Next.js 16 treats `params` and `searchParams` as async.
2. Keep the client component small: form state and model suggestions. Submit by navigating to a normalized result URL; validate every field again on the server. No write action is needed for a P0 listing check.
3. Add `GET /api/rackets/search?q=` or extend an existing bounded lookup. Return at most eight records with ID, brand, name, year, thumbnail, and variants. Reject invalid/oversized queries with 400, debounce on the client, and query the database with a limit rather than calling `loadIndex()` on every keystroke. Inspect query plans before adding indexes.
4. Put pure input normalization, fit interpretation, tradeoffs, checklist generation, and price-state selection in `src/lib/listing-check/`. Keep database access in `src/lib/data/listing-check-repository.ts`, loading only the selected racket, variant, eligible offers, and relevant history. Keep one domain rule for each conclusion rather than copies in SQL and components.
5. Limit the result URL to `racketId`, optional `variantId`, optional `priceVnd`, optional `condition`, and non-sensitive choices. Bound lengths and values, discard unknown keys, and exclude the Facebook URL, photos, post text, seller details, and health answers. Add `noindex` to personalized query results; the empty `/check` page may be indexed.

**Structured result contract:** `modelMatch: exact | ambiguous | missing`; `fit: supported | needs_profile | uncertain` with `reasons[]` and `tradeoffs[]`; `price.status: comparable | reference_only | insufficient | stale` with `evidence[]`, `observedAt`, `source`, and `sampleSize`; plus `questionsForSeller[]` and `alternatives[]`. UI language must come from these explicit states, not from a single numeric score.

### 4.2 Model matching

- Normalize case, whitespace, and separators; search brand plus model. Preserve Play/Tour/Pro, generations, 3U/4U, and grip sizes as distinct choices. A similar slug alone is not an exact-match claim.
- Return at most eight candidates and a match state; the buyer confirms the selection. “Astrox 77” needs a follow-up variant question. Unknown release year remains “generation unconfirmed.”
- Log match failures as codes/categories rather than raw Facebook post text. Maintain a manually curated set of 30–50 commonly requested and confusing models.

### 4.3 Storage and migrations

**P0:** Prefer no new listings table. Reuse `rackets`, `racket_variants`, `offers`, and `price_points`; calculate the check per request and do not persist the Facebook post. If metrics are needed, collect aggregate events without listing content. Do not allow anonymous inserts into `offers` or `price_points`.

**P1, only with moderation:** Add a separate `used_offer_observations` table, for example `id`, `variant_id`, `condition`, `price_vnd`, `source_kind`, `observed_at`, `last_confirmed_at`, `status`, optional `seller_id`, and `created_at`. Publish only reviewed records; record who confirmed them and when they expire. User submissions enter a separate queue with spam controls and do not become verified evidence automatically. Do not republish private-group posts or images. RLS permits public read of approved rows, submitter read of their own rows when signed in, and publication only by moderators. The admin app needs review, edit, removal, and an audit trail.

**P2:** Curate videos by `racket_id`, source URL, author, language, date, topic, timestamps, and moderation status. Publish only reviewed entries. Review CSP and page weight before embedding; link out by default if a player degrades loading.

Every migration must apply after existing migrations and include appropriate checks, indexes, RLS, and an application fallback while the database is not yet upgraded. Seed data and pages running without Supabase must say **sample data**, never imply live market prices.

### 4.4 Later flows

| Flow | Frontend | Backend and condition |
| --- | --- | --- |
| Save a price alert | After the price context, “Tell me when a retailer offer drops below…” asks for sign-in only when saving. Explain that Timvot monitors its own tracked offers, not private Facebook groups. | Reuse `watchlist` and notifications. Validate variant and target price, deduplicate, and test triggering and delivery. Checking a listing stays account-free. |
| Report incorrect model or price | “Something wrong?” offers preset reasons (`wrong_model`, `wrong_variant`, `stale_price`, `other`), with optional free text later. | Start with aggregate events. If individual reports are needed, use a rate-limited, privacy-filtered queue visible only to staff. An anonymous report must not directly change public prices. |
| Current racket and goals | Ask after the first result, allow skip, and explain differences from the current racket. | Version Finder input so old links still work. Test real pairs; “upgrade” must not silently mean a more expensive racket. |
| Review video | Show author, date, and topic; load a player only after a click or open YouTube. | Moderate URL, timestamps, and match to the correct racket generation. Label seller content; do not copy videos to Timvot. |
| Photo and OCR | Buyer explicitly selects a photo, reviews the extracted model/variant, and corrects it before analysis. | Evaluate only after P0 usage tests. Define image processing, storage/deletion, and accuracy on real samples. OCR is a suggestion, never an authenticity certificate. |

## 5. Price policy before any “good price” claim

1. **Compare like with like.** Match `variant_id`; separate `new`, `open-box`, and `used-*` conditions. With unknown variant or condition, present a labeled reference, not a verdict.
2. **Use available, fresh offers.** Require `status = live` and `qty_available > 0`, and show observation date. Product configuration should define a freshness threshold; 48 hours is an initial hypothesis for the current crawl cadence and needs operational validation. `updated_at` alone is not proof of newly confirmed stock.
3. **Require adequate evidence.** As an initial, testable policy, show a comparable range/median only with at least three eligible observations from at least two independent sellers for the same variant and condition within the freshness window, with sample size visible. Otherwise say “insufficient data.” A seller-declared condition on a used racket supports only a reference, not a certified bargain.
4. **Separate list and transaction prices.** MSRP is a distinct reference. Do not present `lowestPrice ?? msrp` as “current price”; when no live offer exists, `currentOfferPrice = null`.
5. **Name price history accurately.** `variantPriceFromPoints()` calculates `median30` from the final third of observations. Before labeling it “30 days,” either implement a real calendar window everywhere with tests or change the UI label to “recent observations.” The check page must not invent another formula.
6. **Show known total cost.** Include shipping, stringing, and warranty when available; mark missing amounts “not included/unknown.” Do not claim “cheapest” from incomplete totals.

Keep this policy in tested pure functions. Cover missing variant, no offers, one seller, stale offers, new versus used, several prices on one day, outliers, sample data, and missing Supabase. The UI must render `insufficient` or `reference_only` rather than zero or unsupported praise.

## 6. Privacy, security, and operations

- Do not scrape or automatically access private-group posts. P0 sends neither photos nor post bodies to the server. If later uploads are introduced, require buyer action, limit file type and size, strip sensitive metadata, set retention and deletion rules, and never auto-publish images.
- Validate all URL input on the server. Limit search length, result count, and request rate; avoid a full-table query per keystroke. Never server-fetch an arbitrary buyer-provided URL, which could create SSRF or redirect problems.
- Keep seller names/photos, Facebook URLs, personal asking prices, and shoulder/elbow answers out of analytics, logs, and Open Graph metadata. Do not infer medical advice from a discomfort question.
- Show “verified seller” only for sellers Timvot has checked under its existing process. Do not transfer that label to an external Facebook account. Keep sponsored placement separate from fit ranking and price conclusions.
- Cache normalized catalogue and offer data, not personalized result pages publicly. Use existing cache tags such as `TAG.rackets`, `TAG.offers`, and `TAG.pricePoints` for relevant reads and verify crawler refresh behavior. Bound responses and measure cold-load time and transfer size on the current hosting tier.

## 7. Product and quality measures

Minimum events: `check_started`, `model_selected`, `check_completed`, `price_insufficient`, `seller_questions_copied`, `compare_opened`, `retailer_offer_opened`, and `check_feedback_submitted`. Event properties may include entry source, locale, match status, price status, and action type. They must exclude post bodies, Facebook URLs, health answers, and individual seller identity.

Track catalogue coverage for popular models: photo, release year, exact variant, and fresh offer. Track the share of checks with insufficient price evidence and reports of wrong models, prices, or stock. Measure time from landing to first result and to task completion on a slow mobile connection. Initial research target: at least 8 of 10 observed buyers understand the conclusion and their next step. No used listing should be called a bargain solely from new-racket price history.

## 8. Delivery slices and independent PRs

| PR | Frontend | Backend/data | Verification and exit condition |
| --- | --- | --- | --- |
| **0. Price-data and language audit** | Inventory every `lowestPrice ?? msrp`, “30 days,” “in stock,” and “verified” label. | Inspect 30–50 popular/confusing models, variants, prices, sources, and timestamps; agree the price-state decision table. | Curated real scenarios and classified issues exist. Do not advertise “price checking” yet. |
| **1. Trustworthy price foundation** | Separate live offer from MSRP in Finder and relevant cards; show missing-data states. | Shared pure `priceContext`, correct variant/condition offer query; fix or relabel `median30` consistently. | Unit tests cover Section 5. Browser test confirms no offer means no buy-now price. |
| **2. P0 check page** | Mobile `/[locale]/check` form, model lookup, errors, three-answer result, copy button, both `messages/vi.json` and `messages/en.json`. | Bounded lookup, `listing-check` domain and repository, server validation, `noindex` for query results. | Browser flows in vi/en for exact/ambiguous/missing model, missing price, no offer, and network failure; keyboard, screen-reader, 320 px and 375 px checks. |
| **3. Connected buyer journey** | Three home entry paths; Check actions from Finder/detail/compare; compare checked racket with alternatives; safe share link. | Bounded alternative lookup and allowlisted public URL state. | Buyer can go from `/vi/check` to result to comparison and back without losing input; share link contains no sensitive data. |
| **4. Private beta and measurement** | Events, short usefulness question, copy fixes from observation. | Error and cold-path monitoring, price freshness checks, gated invitation before public CTA. | Ten observed mobile sessions; data QA; relevant tests, typecheck, build, and Playwright pass. |
| **5. Saving and feedback, P1** | Variant-specific price alerts, incorrect-data feedback, optional current-racket/goal questions. | Reuse watchlist, verify notification trigger, add feedback queue if needed, maintain old Finder links. | Anonymous buyers still get results; alerts cover tracked offers only; anonymous feedback cannot rewrite public data. |
| **6. Used-market evidence, P1** | Condition-matched used references and sample count; correction UI. | Observation migration and RLS, admin moderation, expiry, deduplication, and spam control. | Unreviewed records are never public; stale or different-condition evidence cannot drive conclusions. |
| **7. Rich evidence, P2** | External videos and contextual reviews; photo/OCR experiment only if demanded. | Curated sources, image permissions, OCR accuracy, and page-load assessment. | No unsupported review claims or material page slowdown; test whether buyers understand decisions better. |

PRs 0–4 form the P0 release path. PRs 5–7 depend on beta findings; PRs 6–7 also require an accountable moderation/content owner. If a PR edits several TSX components, perform the project's React review step.

## 9. Public-release acceptance criteria

- Anonymous buyers can find, check, and compare on mobile without a paywall.
- “Astrox 77” remains ambiguous until Play/Tour/Pro and relevant variant are confirmed; 3U price never decides a 4U listing.
- A used listing is not directly compared with a new-racket price series. Sparse evidence says “insufficient data.” MSRP, current offer, and buyer-entered price have separate labels.
- Every conclusion includes reasons, a tradeoff, evidence source/freshness, and actionable seller questions.
- Share URLs and analytics contain no private-group content, Facebook URL, personal photos, seller identity, or health answers.
- Both locales are complete. Layout works from 320 px without horizontal overflow, controls remain reachable, and keyboard/screen-reader flows work.
- New reads do not build a complete catalogue index for each lookup/check. Cold-load measurements and behavior without a migration or Supabase configuration are checked.
- Relevant tests, typecheck, build, and Playwright pass. At least ten real buyers are observed and repeated misunderstandings are corrected.

## 10. Decisions to preserve

1. **Language follows evidence strength.** “Insufficient data” is a useful result.
2. **One rule per conclusion.** Finder, Check, detail, and comparison share pricing and fit logic rather than copying it across layers.
3. **P0 works without storing Facebook posts.** This keeps the flow quick and lets the team test value while limiting privacy exposure.
4. **The buyer path remains free.** Require an account only when the buyer actively saves something or submits content that must be tied to an identity.

## 11. AI-native SDLC for this initiative

The referenced playbook describes a loop of **Plan → Design → Build → Test → Deploy → Maintain**, with a versioned artifact at each handoff and human judgment at acceptance gates. For this single repository, keep the artifacts beside the code and run the loop per independently releasable slice. AI may draft, implement, inspect, and summarize; the named product and engineering owners accept decisions about buyer claims, privacy, migrations, and release. This section adapts the playbook to this project; it does not depend on a particular AI vendor or automatic production changes.

### 11.1 Artifact chain and ownership

Use `docs/initiatives/facebook-listing-check/` as the proposed home for implementation artifacts. Do not mark a draft accepted merely because an AI produced it.

| Stage | Versioned artifact | Required contents | Acceptance owner |
| --- | --- | --- | --- |
| **Plan** | `intent.md` | Buyer's problem in the originator's words, target users, desired outcome, constraints, measurable success, unknowns. Link the existing buyer strategy as evidence. | Product owner, after checking with target buyers. |
| **Design** | `spec.md` | User journeys, state matrix, wireframes or screen descriptions, structured result contract, price truth table, privacy/accessibility/performance requirements, unresolved concerns. This document is the draft source. | Product owner; engineering/data owner accepts price and data feasibility. |
| **Build** | `plan.md` per PR or slice | Exact files and migrations to touch, work order, dependencies, tests, data fixtures, performance checks, risks, rollback route, and proof to collect. | Implementing engineer or tech lead before code changes. |
| **Test** | Tests and PR evidence | Unit/integration/browser results, manual mobile and accessibility findings, screenshots when UI changes, failed-case reproduction, residual risks. | Engineer and reviewer; product owner reviews buyer comprehension. |
| **Deploy** | PR, release record, migration record | Review findings, CI status, preview link, feature gate, rollout/rollback steps, and approval for production. | Maintainer/release owner; product owner accepts public buyer claims. |
| **Maintain** | Dashboard/incident notes and new `intent.md` | Control-band breach, impact, diagnosis, fix or rollback, and a regression scenario that returns to Plan. | On-call/maintainer plus product or data owner where trust is affected. |

Use Git history and PR links as the audit trail. Record the owner and acceptance decision in the PR or artifact front matter. The first concrete implementation task is to extract and review `intent.md` and `spec.md` from this draft, then create an engineer-approved `plan.md` for PR 0. The Vietnamese strategy captures the original problem statement; preserve that voice when drafting intent.

### 11.2 Plan: confirm the buyer problem

Capture how a Vietnamese buyer currently jumps between Facebook groups, video reviews, shops, and messages, and what decision still feels uncertain. Record evidence from buyer interviews or observed searches, not only proposed features. The P0 success criterion is that a buyer can make a more informed next move for a listing they already found. Review the initial scope, free-buyer promise, and exclusions with the product owner. Any unresolved question that changes a price or trust claim must remain explicit in `intent.md`.

**Exit gate:** product owner accepts the problem, target segment, constraints, and initial metric; the artifact is committed and linked to the next stage.

### 11.3 Design: specify states before screens

Turn accepted intent into `spec.md`. Start with the buyer journey and the state matrix: exact/ambiguous/missing model × known/unknown variant × new/open-box/used/unknown condition × comparable/reference-only/insufficient/stale price × complete/partial player profile. Specify the copy and next action for each meaningful state. Include the mobile result order, localization, accessibility, structured API contract, and no-data fallback. Review the pricing truth table with a data owner and privacy rules with the maintainer. A prototype may help, but the accepted state behavior is the implementation contract.

**Exit gate:** product owner accepts the experience and language; engineer/data owner accepts the data contract; any unresolved source, moderation, or privacy issue is either resolved or explicitly deferred from P0.

### 11.4 Build: plan each small slice, then implement

For each PR in Section 8, write a short `plan.md` that names files, ordered edits, migrations, tests, proof, and rollback. Inspect the current code and installed Next.js docs before drafting it. An AI coding agent may propose or implement changes, but an engineer reviews the plan first and updates it when implementation diverges. Keep the price policy in pure domain code, data access in repositories, and UI mapping in components. Avoid combining P0 buyer flow with P1 moderation infrastructure in one PR.

**Exit gate:** the diff matches the accepted plan or records approved deviations; code and documentation are reviewable together.

### 11.5 Test: continuous evidence around buyer decisions

Use deterministic fixtures for the P0 decision engine. For an existing bug, first add a failing reproduction, then fix it without weakening the test. Start with `lowestPrice ?? msrp`, the `median30` label, variant/condition mismatch, stale stock, and ambiguous models. Add integration checks for bounded search and Supabase/RLS read behavior, and browser checks for the full vi/en mobile path. Review visual changes at 320 px and 375 px, keyboard and screen-reader behavior, partial failures, and safe share metadata. Attach the results and relevant screenshots to the PR.

The playbook's model evals become relevant **if** P2 introduces OCR or generated Q&A. Then keep a versioned set of real, permissioned examples; measure model/variant accuracy, abstention, harmful price certainty, and Vietnamese-language clarity before and after prompt/model changes. P0's rule-based flow needs deterministic tests and buyer observation rather than LLM eval infrastructure.

**Exit gate:** required automated checks pass, critical price/privacy scenarios are reviewed, and known limitations are listed with owners.

### 11.6 Deploy: review, stage, release, and roll back

Use AI-assisted review to surface suspect logic, privacy leaks, inaccessible states, and migration/RLS mistakes; a human reviewer resolves findings. CI should enforce typecheck, relevant tests, build, and the browser smoke path. Preview the change with realistic, non-private data. For P0, release behind an invitation or feature gate, run the ten buyer sessions, then make the public CTA visible after the acceptance criteria pass. Any database change uses an expand-first migration and application fallback; rehearse disabling the feature independently of rolling back data. The production deployment, price-policy copy, and RLS changes require named human approval. Record the deployment and rollback route in the PR/release note.

If the team deploys through Vercel, installing the CLI with `npm i -g vercel` enables environment inspection, deployment, and log workflows such as `vercel env pull`, `vercel deploy`, and `vercel logs`. It is an operational convenience, not a prerequisite for drafting or reviewing this plan.

**Exit gate:** the release owner approves the production change, the feature gate and rollback path are tested, and post-release checks have an owner.

### 11.7 Maintain: watch trust signals and feed the loop

Monitor the complete buyer funnel, model-match failures, insufficient-price rate, wrong-price/stock feedback, data freshness, 5xx rate, and mobile result latency. Define alert thresholds from a beta baseline rather than guessing production limits. A trust-affecting incident, such as used prices being judged against new offers or a share link exposing private data, triggers immediate feature disablement or rollback, an incident note, a regression test, and a new `intent.md` if the product behavior must change. Feed repeated buyer misunderstandings into copy/design revisions. Review expiry and moderation queues before expanding P1.

**Exit gate:** production signals and user feedback have named owners; each material issue produces a documented correction or a new accepted intent.

### 11.8 Practical adoption order and measures

1. **Before PR 0:** agree on `intent.md`, `spec.md`, owners, and the price-state truth table. Keep Section 8 as the initial build backlog.
2. **PRs 0–1:** establish fixtures, decision tests, accurate price language, and PR evidence. These are the trust foundation for the listing-check claim.
3. **PRs 2–4:** implement and beta-test the full buyer loop, then publish only after observations and release gates pass.
4. **After beta:** use measured demand and moderation capacity to choose P1/P2 work; reopen Plan when the problem changes.

Measure both **delivery health** (time from accepted intent to usable beta, rework after spec acceptance, PR review latency, failed releases) and **buyer trust** (task completion, comprehension, incorrect price claims, stale evidence, safe sharing). Faster code generation alone is not a success metric.
