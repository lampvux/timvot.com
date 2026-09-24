# Local AI guide publisher

The implementation plan is [ai-guides-plan.md](ai-guides-plan.md).

## Setup

Use Node 24 and the existing project dependencies (`npm install`). Start 9router
on this Windows machine. In its dashboard, connect the provider/model or combo
you want to use and check its quota, pricing, and fallback policy. The worker
uses one explicitly allowed model; listing a model does not establish that it
is free. For free-only use, choose a combo containing only confirmed free routes.

Add these to the ignored `.env.local`:

```dotenv
NINE_ROUTER_BASE_URL=http://localhost:20128/v1
NINE_ROUTER_API_KEY=<key from your local 9router dashboard>
NINE_ROUTER_MODEL=<exact model ID from npm run guides:models>
NINE_ROUTER_ALLOWED_MODELS=<same ID; comma separated if you approve several>
NINE_ROUTER_API_MODE=chat
NINE_ROUTER_REASONING_EFFORT=low
NINE_ROUTER_REQUEST_TIMEOUT_MS=600000
GUIDE_TIMEZONE=Asia/Hovd
```

`NINE_ROUTER_FREE_MODELS` remains supported when `NINE_ROUTER_ALLOWED_MODELS` is
empty or unset. A nonempty `NINE_ROUTER_ALLOWED_MODELS` replaces that legacy
allowlist; it does not enable automatic model selection or fallback.

For xAI, use an exact `xai/...` ID listed by your instance and `chat` mode. For
example, **if `xai/grok-4.6` is listed**:

```dotenv
NINE_ROUTER_MODEL=xai/grok-4.6
NINE_ROUTER_ALLOWED_MODELS=xai/grok-4.6
NINE_ROUTER_API_MODE=chat
```

Adding or switching a provider in 9router does not update `.env.local`. Run
`npm run guides:models` to see all available model IDs without database access
or generation. If the configured model is no longer listed, update both its ID
and the allowlist, and choose the provider's API mode. The worker reads the
shell environment first, then `.env.local`, then `.env`.

The worker uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` already
used by catalogue scripts. The browser never receives the service-role or model
key. Migration execution also needs the existing Postgres connection credentials.
OpenCode Muse models use 9router's Responses API, so set `NINE_ROUTER_API_MODE` to
`responses` for them. Use `chat` only for models whose provider supports ordinary
`/v1/chat/completions` requests.
`low` reasoning is deliberate for this structured editorial pipeline: it leaves
enough of the model's output budget for both complete translations. The worker
sends this setting to xAI Chat Completions as `reasoning_effort`; without it,
Grok 4.6 defaults to high reasoning and can take several minutes on topic selection.
The xAI chat route uses streaming so long bilingual responses are received as they
are generated instead of waiting behind 9router's non-streaming response window.
Generation requests allow 10 minutes by default because long bilingual xAI output
can take more than three minutes through 9router. Set
`NINE_ROUTER_REQUEST_TIMEOUT_MS` between `60000` and `1200000` to tune this. The
worker logs the stage, elapsed time, response status, and model without logging
prompts or credentials.

Apply the additive guide migration once:

```powershell
npm run migrate -- --file=supabase/migrations/20260920000000_ai_guides.sql
npm run guides:check
npm run guides:research
npm run guides:generate -- --dry-run
npm run guides:daily
```

`guides:check` verifies model discovery, the explicit model allowlist, and access to the
guide schema. It does not spend a generation request. A dry run performs research,
generation, validation and review, saves a local artifact, and does not write the
database. `guides:daily` publishes at most one guide for today's calendar date in
`GUIDE_TIMEZONE`. Repeating it after successful publication is a no-op. A failed
run can be retried. A manual run deliberately permits one additional unique guide:

```powershell
npm run guides:generate
```

No public generation endpoint is exposed. The deployed site only reads completed
articles at `/vi/guides/<slug>` and `/en/guides/<slug>`.

## Daily Windows schedule

After a real generation succeeds, register the task:

```powershell
npm run guides:schedule
# Optional alternate machine-local time:
npm run guides:schedule -- -At 08:30
npm run guides:schedule -- -Status
# Stop automatic generation:
npm run guides:schedule -- -Remove
```

The default is 09:00 in the Windows machine's timezone. Set `GUIDE_TIMEZONE` to the
same zone for consistent day boundaries. The task runs hidden as the current
signed-in user, with no stored account password and no administrator elevation.
The computer must be on, that user signed in, and 9router running. The task catches
up after a missed start and retries failures twice at 30-minute intervals. It
does not generate a backlog for days the machine was off. The runner has a
30-minute scheduler limit; the pipeline has a 25-minute publication budget.

Task Scheduler ignores overlapping starts. A database lease also prevents manual
and scheduled runs from overlapping, including on different machines. A fencing
token prevents an old worker from publishing after its lease has been replaced.

## Sources and editorial checks

Edit `SOURCE_PAGES` in `scripts/guides/sources.ts` to expand the research registry.
It starts with Yonex, Victor, Vietnamese retailers, and BWF. It visits the
configured pages, discovers relevant same-origin pages, and rotates the latter
each day. It is intentionally a bounded crawl of approved public sources, not a
search engine or a crawl of the entire web. Blocked, unavailable, or disallowed
sources are skipped. No paywall or sign-in bypass is attempted.

The worker respects applicable robots rules, accepts only HTTPS registry hosts,
rejects private addresses and unapproved redirects, limits response sizes, and
caches research for 20 hours. Model-generated URLs are never fetched. Cached
evidence preserves its original access timestamp.

Topic selection rotates among rackets, strings, comparisons, buying, prices,
maintenance, and technique according to source evidence and past category counts.
All prior guide metadata is considered, with a bounded context budget. Local
checks compare against every prior body; the editorial model checks the closest
20 articles. Canonical topic and body hashes have database unique indexes.
Semantic similarity cannot be guaranteed perfectly, so suspicious overlap stops
publication instead of accepting a renamed topic.

Both languages need 450–3500 words, matching section IDs, valid source references,
and citations from two independent source operators. The reviewer checks factual
support, originality, bilingual consistency, and novelty. Both translations are
committed together only after all checks pass. Failure publishes nothing.

The model sees public research and prior public guide content, never database
credentials, cookies, or private user records. Articles render plain text and
structured tables; model output cannot execute HTML, JavaScript, or MDX.

## Logs, retries and cache refresh

Local research, drafts, and scheduler logs live under the git-ignored
`scripts/guides/output/`. Database `guide_generation_runs` records state, attempts,
lease, error, and the committed guide slug. It has RLS with no public policies.
Each run allows at most eight model requests, retries only HTTP 429/5xx, uses
timeouts, and never falls back to another model automatically.

Set `REVALIDATE_URL` to the site's existing `/api/revalidate` endpoint and use the
same `REVALIDATE_SECRET` locally and in the deployed app. Successful publication
invalidates the `guides` cache. The endpoint uses stale-while-revalidate, so a
visitor can briefly receive the old listing while the new one fills. Without
this configuration, the existing catalogue cache refreshes on its normal window
(currently six hours). Retry cache refresh separately:

```powershell
npm run guides:revalidate
```

If an older generated guide predates a stricter Vietnamese-language validator, repair only its translation while preserving the English facts and citations:

```powershell
npm run guides:repair-vi -- <guide-slug>
```

A cache-refresh failure never regenerates or rolls back a committed guide. If
publication's network response is interrupted, re-run the same daily command:
the database records publication atomically and prevents a second article.

If 9router returns 401, check the local key. If it returns 429, wait for provider quota
to recover. If JSON is malformed, output is truncated, evidence is insufficient,
or review fails, inspect the local artifact/log before retrying. Do not solve a
free-only quota failure by enabling a paid fallback. Clear old local artifacts/logs
periodically according to your desired retention.

## Validation

```powershell
npm run typecheck
npm run test:guides
npm run test:guardrails
```

For an end-to-end check, publish once, open both locale URLs, click several
contents links, inspect a narrow viewport, and repeat `guides:daily`. Confirm it
reports no work and the database still has one guide for the daily run. Also
verify an unpublished/nonexistent slug cannot be read anonymously.

Vercel CLI is optional for this local worker. For managing the deployed site's
environment, deployment, and logs, install it with `npm i -g vercel`.
