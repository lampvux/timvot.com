# Daily AI badminton guides

## Outcome and architecture

Publish one new bilingual badminton guide per day from a local TypeScript worker.
Windows Task Scheduler and a manual CLI invoke the same pipeline. The worker calls
`http://localhost:20128/v1/chat/completions`, writes to the existing Supabase
project, and invalidates the site's `guides` cache. Reading a published guide never
depends on the local machine or an LLM request.

The existing app has guide summary cards and a `guides` table with bilingual body
fields. This implementation extends those fields with a versioned JSON document,
preserves legacy text articles, and adds `/vi/guides/[slug]` and
`/en/guides/[slug]`. Desktop uses a sticky contents sidebar on the left and readable
article content on the right. Mobile uses an expandable contents menu.

## Implementation sequence

1. Add article validation, source metadata, categories, and summary/detail reads.
2. Add a migration for generation provenance, unique topic/content fingerprints,
   and transactional job claiming/publication with leases and fencing tokens.
3. Collect evidence from an extensible registry of badminton manufacturers,
   retailers, and governing-body pages. Discover relevant links from those pages;
   cache research locally, respect robots rules, and bound requests and redirects.
4. Select a distinct topic using all prior titles/topic metadata; compare the
   resulting article against published bodies. Ask the LLM to check factual
   support, novelty, source coverage, and bilingual consistency before publication.
5. Publish both languages atomically, record the model/sources/time, then refresh
   the existing site cache. Retrying a completed daily run must do nothing.
6. Add listing/detail navigation, sources, metadata, localized labels, and a
   keyboard-accessible table of contents. Verify desktop and mobile.
7. Register the local daily task after a real generation succeeds. Document CLI,
   setup, logs, failures, dry runs, and stopping the task.

## Editorial policy

Rotate rackets, strings, comparisons, buying advice, prices, maintenance, and
technique. Research broadly across configured public sources; "all sources" is
an extensible collection, not a promise to crawl the entire web. Manufacturer
facts take precedence over retailer marketing. Price claims need a currency,
retailer/market, and observation date. Community anecdotes are not specifications.
Never invent hands-on testing, exact prices, citations, or product characteristics.
Write original explanations and attribute source material, without copying articles.

Require at least two independently operated source hosts, validate citation IDs,
reject unsupported claims, and fail closed if evidence, novelty, or either
translation fails. A failed day publishes zero guides rather than weak content.
Exact topic/content duplicates are blocked in PostgreSQL. Text similarity and an
LLM novelty check also reject overlapping articles; semantic uniqueness is a
quality gate, not a mathematical guarantee.

## Operational decisions

- Use existing Supabase and local 9router; no new hosted AI or database service.
- Pin a model explicitly and allow only user-confirmed free model IDs. Never
  silently fall back to another model or paid provider. Check the selected combo's
  own fallback policy in 9router as well.
- Default schedule: 09:00 local machine time; daily identity uses `GUIDE_TIMEZONE`
  (default `Asia/Hovd`). The machine and 9router must be running. A missed task may
  run after startup, but does not bulk-publish missed days.
- Daily runs are idempotent; manual runs intentionally allow another distinct
  guide. Database leases prevent concurrent manual/scheduled publication.
- Bound source requests, model attempts, output size, and job duration. Persist
  diagnostic artifacts locally without secrets. Do not expose generation in a
  public HTTP route. Keep service-role and 9router keys in local environment files.
- Store failed attempts and keep drafts private. Cache refresh failure must not
  cause another article to be generated.

## Acceptance checks

- One real bilingual guide generated through the configured free 9router model,
  persisted to Supabase, and readable in both locales.
- Re-running the same daily key publishes nothing; overlapping claims cannot win.
- Duplicate topics/body hashes, bad citations, malformed JSON, and failed review
  cannot become public; anonymous users cannot access job diagnostics or write.
- A new slug works without rebuilding; a missing/unpublished guide returns 404.
- Desktop contents stay on the left, mobile has no horizontal page overflow,
  section links work, and article/source text is rendered without raw HTML.
- Unit tests cover validation, similarity, source URL controls, and retries;
  database checks cover claim/fencing/publication where a live database is available.

## Verified starting point (2026-09-20)

`GET /v1/models` succeeds locally. An unauthenticated chat completion returned
401 "Missing API key"; generation requires local credentials and a confirmed free
model. The existing `guides` cache tag and authenticated revalidation endpoint can
be reused. The application uses Next.js 16.3.1 with Cache Components; implementation
must follow its bundled docs, including async route params and cache boundaries.

9router's [official integration documentation](https://github.com/decolua/9router/blob/master/gitbook/content/en/integration/other-tools.md)
describes the compatible endpoint and Bearer authentication. Windows scheduling
uses [Task Scheduler settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset),
including missed-start handling and overlapping-instance prevention.
