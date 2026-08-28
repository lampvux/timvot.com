# Shuttlecraft

The neutral spec database and price-comparison layer for badminton rackets, with a
verified seller marketplace attached. Vietnam first, English available.

Built from `badminton-platform-brief.md` and the Shuttlecraft design system
(`Responsive website design layouts.zip` → `_ds/`). Design tokens are ported verbatim
into `src/app/globals.css`; the eight screens in the responsive spec map onto the routes
below.

## Stack

| Layer     | Choice                                                       |
| --------- | ------------------------------------------------------------ |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript      |
| Styling   | Tailwind CSS v4, design tokens as CSS custom properties       |
| Data      | Supabase (Postgres + RLS)                                     |
| Auth      | Supabase Auth (`@supabase/ssr`, cookie sessions)              |
| i18n      | `next-intl` — `vi` (default) and `en`, locale detected per request |
| Icons     | Lucide                                                        |
| Fonts     | Archivo (display), Be Vietnam Pro (UI), JetBrains Mono (data) |

## Running it

```bash
npm install
npm run dev
```

It runs with no configuration. Without Supabase keys the repository falls back to the
seeded catalogue in `src/lib/data/seed.ts` — 18 rackets, 6 brands, 6 sellers, 73 offers,
90 days of price history and 124 reviews. Everything except sign-in, the watchlist and
price alerts works exactly as it will against Postgres.

### Connecting Supabase

```bash
cp .env.example .env.local   # fill in the two keys from Project Settings → API
```

Then apply the schema and the seed:

```bash
supabase link --project-ref <ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

`supabase db push` wants an interactive login and a password prompt, which is awkward
from a script or an agent session. `npm run migrate` applies the same
`supabase/migrations/*.sql` non-interactively, tracking what it has run in a
`schema_migrations` table and wrapping each migration in its own transaction:

```bash
npm run migrate:dry                                  # list migrations, touch nothing
npm run migrate                                      # apply everything pending
npm run migrate -- --file=supabase/scraped-catalogue.sql
```

It needs DDL access, which means **`SUPABASE_ACCESS_TOKEN`** (a personal access token,
used against the Management API) or **`SUPABASE_DB_URL`** (a direct `postgres://` string).
A service-role key is deliberately refused: it authenticates against PostgREST, which
executes no DDL, so it can insert catalogue rows but cannot create a table.

`supabase/seed.sql` is generated, never hand-edited:

```bash
npm run seed:sql
```

That keeps Postgres and the no-database fallback byte-identical. Editing
`src/lib/data/seed.ts` and re-running it is the only supported way to change seed data.

## Routes

| Route                            | What it is                                              |
| -------------------------------- | ------------------------------------------------------- |
| `/[locale]`                      | Home — finder entry, trending, price drops, guides       |
| `/[locale]/rackets`              | Catalogue with faceted filters (filters live in the URL) |
| `/[locale]/rackets/[brand]/[model]` | Racket detail — the page everything else serves       |
| `/[locale]/compare?ids=a,b,c`    | Comparison table, 2–4 rackets                            |
| `/[locale]/finder`               | Five-question quiz → ranked shortlist with reasons       |
| `/[locale]/deals`                | Variants trading below their 30-day median               |
| `/[locale]/sellers`, `/sellers/[slug]` | Seller directory and storefronts                   |
| `/[locale]/guides`               | Editorial index                                          |
| `/[locale]/methodology`          | How the Court Score is calculated — the trust page       |
| `/[locale]/account`              | Watchlist and price alerts                               |
| `/[locale]/seller/dashboard`     | Listings, stock, order counts                            |
| `/[locale]/sign-in`, `/sign-up`  | Supabase Auth                                            |
| `/auth/callback`                 | Email confirmation exchange                              |

## The parts worth knowing about

**`src/lib/types.ts`** — the spec schema, defined once. These fields become the filter
facets, the comparison rows and the Finder inputs. Changing a name here is a migration.

**`src/lib/court-score.ts`** — the Court Score, in full. 50% spec profile (deterministic,
from the catalogue record) and 50% player score (verified reviews, weighted 3×/2×/1× by
verification tier). Nothing in the file reads a seller, an offer, a price or a promotion,
which is what makes the score un-buyable. A racket with fewer than five verified reviews
has **no** Court Score — `total` is `null` and the UI says "spec profile only" rather
than passing off half a score as a whole one. Every coefficient is published on
`/methodology`.

Run `npx tsx scripts/score-report.ts` to see the score for every seeded racket.

**`src/lib/data/repository.ts`** — one read path. Supabase when linked, seed when not,
same shapes either way, deduped per request with React `cache`.

**`src/components/ds/`** — the design system: `primitives.tsx` (Button, Card, Badge, Tag,
TrustBadge, Icon), `forms.tsx`, `data.tsx` (BalanceRuler, ScoreBars, PriceHistory,
PriceDelta, StockLabel).

**The Balance Ruler** (`src/components/ds/data.tsx`) is the signature element: every
racket and every comparison plots balance point on the same fixed 280–305 mm rule. In
comparison mode all markers sit on one rule, so the answer is visible before you read a
word. There is no radar chart anywhere, deliberately.

## Design rules the code enforces

- Hairlines separate, shadow floats. A card in a grid gets `1px solid` and no shadow.
- Colour carries meaning, never decoration. Green is action, amber is low stock, cyan
  means live data. Status is always colour **and** icon **and** a value.
- Spec labels are eyebrow style in tertiary ink; spec values are mono in primary ink.
  That single pairing, applied everywhere, is what makes the site look designed.
- Stock language: exact count to 10, then `10+`; below 4 switch to "3 left" in amber.
  Never invent scarcity.
- Prices are never abbreviated: `₫3.290.000`, never `₫3.3M`. Deltas carry a sign and a
  window, with U+2212 for minus.
- Empty states say what to do next, with a number: "Removing 'extra stiff' gives 12
  results."
- No emoji, anywhere. No exclamation marks. Sentence case except eyebrows.

## i18n

`vi` is the default locale and `en` is available. A first-time visitor lands in whatever
their browser asks for; the switcher writes `NEXT_LOCALE`, which wins from then on.

Model names and spec codes are never translated — `Astrox 100ZZ 4U G5` is the same string
in both locales, only the sentence around it changes. Vietnamese runs 20–30% longer than
English, so no control is sized to fit its English string.

Localised catalogue text lives in `_en` / `_vi` column pairs in Postgres and is carried
together as `{ en, vi }` in the domain objects; `src/lib/data/mappers.ts` is the only file
that knows about the split.

## The scraper

`scripts/scraper/` walks the Vietnamese retailers' racket catalogues and turns each
listing into a normalised offer.

```bash
npm run scrape                  # every site, every page, with browser verification
npm run scrape:quick            # 3 pages per site, no verification — for iterating
npm run scrape -- --site=vnb --pages=5 --verbose
npm run scrape:sync             # also upsert into Postgres (needs the service role key)
npm run scrape:refresh          # the scheduled one: full walk, no browser, straight to Postgres
```

| Flag | Default | What it does |
| ---- | ------- | ------------ |
| `--site=` | `all` | Comma-separated: `vnb`, `qvbadminton`, `fbshop`, `hvshop`. `all` is those four; `shopee` only when asked for by name |
| `--pages=` | all | Cap the listing pages per site |
| `--sample=` | `5` | Product pages opened in a browser per site during verification |
| `--no-verify` | off | Skip the browser pass |
| `--out=` | `scripts/scraper/output/rackets.json` | `--out=none` to skip the file |
| `--verify-only[=file]` | off | Re-run the browser checks against a saved scrape, without scraping again |
| `--sync-db` | off | Write prices and stock to Postgres; create catalogue rows that do not exist yet |
| `--no-retire` | off | Keep offers this run did not see, instead of pausing them |
| `--force-retire` | off | Sweep even when it would pause more than half a seller's live offers |
| `npm run scrape:sql` | — | Emit the same rows as `supabase/scraped-catalogue.sql`, for when there is no service-role key |
| `--concurrency=`, `--delay=` | `4`, `150` | Requests in flight and the gap between them |

**Sources.** fbshop, qvbadminton and hvshop all run WooCommerce and all expose the
unauthenticated Store API, which gives structured prices, stock and category membership
plus an `X-WP-TotalPages` header that says exactly how far the pagination goes — far
steadier than guessing theme class names. All three, though, publish part of their
catalogue with a price the Store API serialises as `0` (fbshop does it for roughly half
its listings) while the rendered card shows the real number, so the walk is two-phase:
enumerate from the API, then re-read the rendered listing pages and fill in prices by
permalink. What is still priceless afterwards is a *liên hệ* "call us" listing; it is
counted and reported, never given an invented number.

shopvnb is a bespoke storefront with no API, so it is parsed from HTML: `.item_product_main`
is the card, and pagination is `?page=N` walked until a page comes back empty or repeats
its predecessor, because the server clamps out-of-range pages instead of 404ing.

**Shopee is not scraped.** Its search API answers `403` to any request without a
browser-issued device fingerprint. The source stays wired up in case an official Open
Platform key is ever obtained, but it contributes zero products and says why.

**Colourways are variants, not models** (`scripts/scraper/colourway.ts`). Retailers title
the same frame once per colour and once per weight — "Astrox Tour 8500 đỏ", "… xanh",
"… cam", "Nitrix 80 Bullet 4U" — so a single racket arrives as a handful of listings.
Left alone that splits the spec page, the Court Score and the price history several ways
for one frame. The weight, grip and colour come off the model name and become what the
schema already calls them: properties of the variant.

Knowing where a colour ends and a model designation begins is the whole problem.
`Thruster Ryuga CLS C`, `CLS J` and `CLS I` are three different rackets, and
`Kimetsu no Yaiba 40 - Kamado Nezuko` is an edition, not a shade. So the rule is narrow:
strip only a *trailing* run of known colour words, and only while what remains still
carries a model identifier. Anything unrecognised stops the walk and stays in the name.
Where one shop names a colour and another does not for the same racket/weight/grip, the
unnamed listing inherits it — but only when the group names exactly one colour, because
with two the unnamed listing genuinely could be either.

This is what `20260818000000_variant_colourway_key.sql` is for: the original
`unique (racket_id, weight_class, grip_size)` said a racket has one variant per weight and
grip, which is not how these frames are sold. In the current scrape, 131 racket/weight/grip
groups hold more than one colour.

**Loading the scrape into Postgres.** Catalogue writes are admin-only under RLS, so
`--sync-db` needs `SUPABASE_SERVICE_ROLE_KEY` — the publishable and anon keys are rejected
by the `is_admin()` policies, and `scripts/scraper/env.ts` reads both `.env` and
`.env.local`. Without that key, `npm run scrape:sql` writes the identical rows to
`supabase/scraped-catalogue.sql`, which applies through psql or the Supabase SQL editor
with no key at all. Apply the migrations first — the file assumes the schema exists.

**Thumbnails.** `npm run scrape:images` now writes a second object beside each stored
image — a ~400px webp at `<same-key>-thumb.webp` — and records it in
`racket_images.thumb_url`, with the hero's copy denormalised onto
`rackets.hero_thumb_url`. The catalogue grid serves that directly with `unoptimized`,
which is what keeps 3.010 rackets inside Vercel Hobby's 5.000 image transformations a
month; past that allowance the optimizer answers 402 and cards render their alt text.
Resizing costs one pass over bytes the crawler already downloaded, and a frame `sharp`
cannot decode simply produces no thumbnail — the columns are nullable and the card falls
back to the full-size original.

Images crawled *before* thumbnails existed do not get one from a re-run: `scrape:images`
skips rackets that already have a gallery, which is what makes it re-runnable. Backfill
those from the bucket instead of re-crawling every manufacturer site:

```bash
npm run images:thumbs -- --dry-run   # count what is missing, write nothing
npm run images:thumbs                # download from Storage, resize, upload, record
```

It only looks at rows where `thumb_url` is null, so it is safe to interrupt and re-run,
and contacts no manufacturer.

Apply `supabase/migrations/20260828000000_image_thumbnails.sql` before deploying the code
that reads those columns. If you forget, the app notices: it retries the racket query
without them and logs `thumbnail columns are missing`, so you get the full catalogue
without thumbnails rather than the eighteen-racket seed fallback.

**Publishing the change.** The app serves prices from prerendered pages, so a successful
`--sync-db` also asks the deployment to drop the caches it just invalidated:

```bash
REVALIDATE_URL=https://<your-app>/api/revalidate   # the deployed route
REVALIDATE_SECRET=<same value as the deployment>   # bearer secret, any length
```

Both are optional and neither is needed locally: with them unset the scraper says so and
carries on, and the site picks the new prices up when its `cacheLife` window expires. They
exist because Vercel Hobby caps cron jobs at once per day with ±59 minutes of slop, so a
schedule cannot be what publishes a price change — the writer has to be. The call fires
only when the sync reported clean, so a partial write holds the last good catalogue rather
than publishing half of a new one, and a failure to reach the deployment is a warning
rather than a failed run.

**Running it on a schedule.** `npm run scrape:refresh` is the shape meant for a cron
job or a Windows scheduled task: a complete walk of the four sites, no browser, and a
write straight into Postgres. A full walk takes roughly eight minutes and costs about
360 requests; hourly is more than these shops repay, and daily — or twice daily around
the times shops change prices — is the sensible band.

A repeat run is deliberately narrow about what it may change:

- **Prices, stock and offer status are rewritten every run.** That is the point.
- **Catalogue rows are created, never overwritten.** Brands, rackets, variants and
  sellers go in with `on conflict do nothing`. A listing title cannot tell us a frame's
  balance point or a seller's rating, so the placeholder values the scraper carries are
  only ever good enough to open a row that does not exist yet. Curated specs, hero
  images and seller tiers survive every refresh.
- **Offers a shop has stopped listing are paused, not deleted.** After a full walk, live
  offers belonging to the sellers just walked that were not seen this run get
  `status = 'paused'` and `qty_available = 0`, so a delisted racket stops advertising
  last month's price. The variant and its price history stay, and a listing that returns
  tomorrow goes live again on the next upsert. A partial walk (`--pages=N`) never
  sweeps, a source that failed or returned nothing is skipped, and a sweep that would
  take out more than half a seller's board is refused with a warning — a shop that
  changed its theme overnight looks exactly like a shop that delisted everything, and an
  unattended job must not confuse the two. `--force-retire` says you have checked.
- **Price history keeps the lowest price of the day**, folding in what is already
  recorded before writing, so running three times a day records the cheapest of the
  three rather than whichever ran last.

On Windows, point Task Scheduler at the repo with a daily trigger:

```powershell
schtasks /create /tn "Shuttlecraft price refresh" /sc daily /st 06:30 ^
  /tr "cmd /c cd /d E:\Work\Personal Projects\shuttlecraft && npm run scrape:refresh >> scripts\scraper\output\refresh.log 2>&1"
```

The task needs `SUPABASE_SERVICE_ROLE_KEY` — it is read from `.env` / `.env.local`, so
nothing has to be exported into the task's environment.

**Verification** (`scripts/scraper/verify.ts`) is the part that matters. A scraper that
returns a number is not a scraper that returns the *right* number, so after every run
Playwright opens the real category page, counts the cards a person would see, reads the
site's own pager, and then opens a spread of scraped product URLs and checks each one
loads and prints the price we recorded. Coverage below 70% of the site's own count, a
dead product URL or a price that is not on the page all raise it in the report.

The scrape is written to disk *before* verification runs, and a browser that fails to
start is reported without taking the run down — a full walk costs minutes and must not be
lost to a flaky Chromium launch. `--verify-only` re-checks what is already on disk.

## Authentication

Supabase Auth with cookie sessions. Three ways in: **email and password**, **Google**
and **Facebook**. An account is only ever needed for the watchlist, price alerts and
reviews — browsing, comparing and the Finder need nothing, and that should stay true.

Email works as soon as the Supabase keys are set. The social buttons are rendered from
`NEXT_PUBLIC_AUTH_PROVIDERS` (`google,facebook`), which controls the UI only — a provider
must also be enabled in the Supabase dashboard, and the two have to be turned on together.
The default is empty, because a button that bounces off a disabled provider reads as the
site being broken rather than as a provider nobody configured. The list is re-checked
server-side in `signInWithProvider`, so a hand-crafted request naming an unlisted provider
is rejected rather than forwarded.

Provider secrets live in the Supabase dashboard, never in this repo: Supabase is what
talks to Google and Facebook, and the app only ever talks to Supabase.

**`/auth` is excluded from the proxy matcher, deliberately.** `localePrefix` is `"always"`,
so next-intl rewrites unprefixed paths — which sent `/auth/callback?code=…` to
`/vi/auth/callback?code=…`, a route that does not exist. Every OAuth and email-confirmation
redirect landed on a 404 with the one-time code already spent. If sign-in starts 404ing,
look there first.

`/auth/callback` only ever redirects to a path on this site. `next` arrives in a URL a
user can be handed by anyone, so taking it at face value turns the callback into an open
redirect that lands a freshly authenticated visitor on someone else's page. A leading
`//` or `/\` is enough for a browser to read the value as a host, so the check is "starts
with a single slash", not "is not absolute".

Full setup walkthrough, including the Google Cloud and Meta console steps and what each
error message means: **`docs/auth-setup.md`**.

## Manufacturer gallery images

The retailer scrape gives one thumbnail per listing, cropped to whatever box that shop's
theme uses — shopvnb serves 300×300 webp. That is enough for a card and nowhere near
enough for a spec page, and it is the *shop's* photography, re-shot per shop, so one
frame looks different on every listing.

`scripts/scraper/images/` fills that gap from the manufacturers' own sites, and copies
the bytes into Supabase Storage rather than hotlinking them.

```bash
npm run scrape:images:dry           # match only — no credentials, no uploads
npm run scrape:images               # crawl, upload, record
npm run scrape:images -- --provider=apacs --limit=10 --verbose
npm run scrape:images -- --bucket-strategy=per-provider
```

| Flag | Default | What it does |
| ---- | ------- | ------------ |
| `--provider=` | `all` | `yonex`, `yonex-uk`, `yonex-jp`, `victor`, `apacs`, `mizuno-asia`, `mizuno`, `mizuno-vn`, `hundred-vn`, `kumpoo-vn`, `gosen-vn`, `forza`, `meta-vn` |
| `--limit=` | all | Cap the rackets crawled this run |
| `--max-images=` | `12` | Distinct photographs stored per racket, across all its colourway pages |
| `--max-pages=` | `6` | Colourway pages read per racket |
| `--min-pixels=` | `40000` | Drop anything smaller than 200×200 |
| `--min-gallery=` | `2` | Below this, ask the brand's next provider too and keep the richer gallery; `0` disables |
| `--bucket=` | `racket-images` | Or set `SUPABASE_IMAGE_BUCKET` |
| `--bucket-strategy=` | `shared` | `shared` = one bucket, brand folders; `per-provider` = one bucket each |
| `--refresh` | off | Re-crawl rackets that already have images |
| `--refresh-sitemaps` | off | Re-read each provider's catalogue instead of the on-disk cache |
| `--allow-ambiguous` | off | Take a match even when a rival product matched equally |
| `--dry-run`, `--from-file` | off | Report without storing; read rackets from the scrape, not Postgres |
| `--concurrency=`, `--delay=` | `3`, `400` | Deliberately gentler than the retailer scrape |

### Finding the products

Every provider declares one or more `catalogue` sources in `providers.ts`, and they are
tried richest-first and merged by URL. The ladder, cheapest and most precise first:

| Source | Used by | What it gives |
| ------ | ------- | ------------- |
| `woocommerce-store` | apacs, kumpoo-vn | Name + full gallery, from the shop's own Store API. 453 rackets in 5 requests. |
| `shopify-collection` | mizuno, mizuno-vn, yonex-uk, hundred-vn | Name + full gallery from `products.json`. |
| `2beasy-category` | victor | Victor's storefront API. 245 current rackets in 2 requests. |
| `category-pagination` | yonex, gosen-vn, meta-vn | The rendered "all racquets" listing, walked `?p=1…N`. The only way in when a site has no API and no sitemap. |
| `yonex-jp-api` | yonex-jp | yonex.co.jp’s own product JSON, keyed by the model code stamped on the frame. |
| `sitemap` | victor, mizuno-asia, forza | The long tail — discontinued models with no catalogue entry left. Carries no names, so `titleFromHead` reads them from the pages. |

Search is never used: yonex.com disallows `/catalogsearch/` and victorsport.com disallows
`/search`. `scripts/scraper/robots.ts` reads and caches each origin's robots.txt, honours
`Crawl-delay`, and the crawler identifies itself as `ShuttlecraftImageBot/1.0` rather than
pretending to be Chrome the way the retailer scrapers do.

**The category listing beats the sitemap, where there is one.** Yonex's sitemap was the
original source here and it was the wrong one: it lists root-level marketing pages
(`/astrox-77-pro`) but not the racquet catalogue proper (`/badminton/racquets/ax100zz`),
and it mixes both with eight years of press releases. The category listing is seven pages
of twelve and is the manufacturer's own answer to "which of these are badminton racquets".
It also carries the product *name* beside each link, which the URL frequently does not —
Yonex sells "ARCSABER 7 TOUR" at `/arc7-t` and "NANOFLARE 700 GAME" at `/2nf-700g`.
Switching Yonex from sitemap to category listing took it from 25 matched rackets to 62.

**Yonex is three properties, and that is the whole of it.** yonex.com publishes 77
racquets, and the walk is exhaustive rather than approximately so: the eight
sub-categories — arcsaber 9, astrox 34, nanoflare 22, muscle-power 4, isometric 3,
b-series 2, junior 2, duora 1 — sum to exactly the 77 the parent category reports. That is
a current-season line, not a catalogue, so two more official Yonex sites sit behind it:

| Provider | Site | Racquets | Why it earns its place |
| -------- | ---- | -------- | ---------------------- |
| `yonex` | www.yonex.com (Magento) | 77 | The richest galleries — five shots per colourway. |
| `yonex-uk` | www.yonex.co.uk (Shopify) | 35 | The only official site publishing ASTROX 88D Pro/Tour and 88S Pro. |
| `yonex-jp` | www.yonex.co.jp (product JSON) | 49 | The Japanese line, keyed by model code. One shot each. |

They are declared in that order because `index.ts` asks the first provider that matches a
racket, so the extra properties only ever fill gaps rather than displacing a better gallery
with a worse one.

That ordering assumes the site declared first has the better photography, and for the US
storefront it is nearly always right. Nearly: yonex.com carries a **one-shot placeholder**
page for each of the ASTROX 88 D/S frames — it does not really sell them in the US, which
is why yonex.co.uk is in this table at all — while the UK publishes six shots of each. Once
the matcher learned to read `ASTROX 88 S PRO` as "Astrox 88S Pro", the placeholder started
winning, and six flagship rackets would have gone from six photographs to one.

So order still decides who is asked first, and a gallery that clears `--min-gallery`
(default 2) still ends it there — no extra request is made for the ~90% of rackets whose
first provider answers properly. Only a suspiciously thin result costs a look at the next
site, and then the **richer** gallery is the one kept. Set `--min-gallery=0` to switch the
second look off entirely.

Japan is the odd one out and needed a new source kind. It has no per-product page — every
card links out to yonexshop.jp — and it names products in katakana, which will never
compare equal to "Arcsaber 11 Pro". What it does carry is `code`, the model number printed
on the frame, and expanding that back into English is deterministic: `ARC11-P` →
Arcsaber 11 Pro, `3AX88D-G` → Astrox 88D Game, `NF-400` → Nanoflare 400. The leading
`2`/`3` is a generation marker, not part of the name. A code outside the eight known
series is left unexpanded and reported rather than guessed at.

Together the three cover 76 of the catalogue's 570 Yonex rackets. **The remaining 494 have
no official source and never will**: they are discontinued frames, Japan- and
India-domestic models, and retailer colourway rows ("Astrox 2 (BK/YL)", "Astrox 88D Pro
Japan"). Yonex publishes no archive on any of its sites, so this is a ceiling set by the
manufacturer, not by the crawler.

Windowed pagers are walked by exhaustion, not by reading the pager: Yonex's page 1 links
as far as page 5, page 4 links to 6, page 5 to 7. Trusting the first page's highest link
stops three pages early, so the walk instead stops when a page adds nothing new — which
also covers a server that clamps out-of-range pages instead of 404ing.

**Two sites render their grid client-side, and only one needed a browser.** Victor's
category page contains zero product anchors in its HTML, but the grid comes from a plain
POST to a storefront API, so it is read directly — far cheaper than driving Chromium and
more precise than the sitemap. Mizuno's Asian site is a Wix Stores build behind a signed,
token-authenticated API, and there rendering the page is the honest way in.
`scripts/scraper/images/browser.ts` opens one Chromium session per run, and only when a
selected provider actually needs it.

### Storage layout

One bucket, `racket-images`, partitioned by brand:

```
racket-images/<brand>/<model>/<nn>-<sha8>.<ext>
              yonex/astrox-77-pro/00-4d1f8c22.webp
              victor/auraspeed-3200/03-15af485d.webp
              mizuno/acrospeed-001/00-8f31a07c.jpg
```

**The provider is not in the key.** It used to be the first segment, and that broke the
one property the layout exists for: a brand crawled from several of its own sites was
scattered across `yonex/`, `yonex-uk/` and `yonex-jp/`, with Mizuno likewise over
`mizuno-asia/`, `mizuno/` and `mizuno-vn/`. Which folder a racket landed in was decided
by which property matched it first — provider declaration order, an implementation
detail, showing up in the address of the bytes. Which site a photograph came from is
provenance, and it is recorded in `racket_images.provider`, where it can be queried.

`scripts/scraper/images/relayout.ts` moved the 1561 objects already stored under the old
layout; it prints the plan and needs `--apply` to act, refuses to start if two rows would
land on one key, and is safe to re-run because a row already brand-first is skipped.

`--bucket-strategy=per-provider` shards the bucket instead — `racket-images-yonex`,
`racket-images-victor` — and the key is the same either way. One manufacturer's assets
are one subtree, which is what makes "take our photography down" a prefix delete rather
than a query. The RLS policies in
`20260819000000_racket_images.sql` are written against the `racket-images%` prefix so
both layouts are covered, and `ImageStore` is an interface because whose object storage
holds a copy of someone else's asset is a deployment decision, not a crawler one.

Filenames carry the first eight characters of the content hash, so a re-crawl of the same
photograph writes the same key and overwrites itself instead of accumulating
`image-1.png`, `image-1-2.png`. The full sha256 is the dedupe key in `racket_images`,
keyed `(racket_id, checksum)` — manufacturers reuse one photograph across a model's
colourways and across regional sites, and URL comparison does not catch that because the
query string differs.

**A brand can have more than one provider.** Mizuno has three: `mizuno-asia`, the Wix
badminton site covering the whole Asian line including frames long out of production, and
the Shopify storefronts `mizuno` (Malaysia) and `mizuno-vn` (Vietnam), which list what
each country stocks today. They are separate providers rather than one merged source,
because that is what lets `racket_images.provider` and the run report say which
photograph came from which property. `mizuno-asia` is declared first because it matches roughly three times as
many rackets; the storefronts then pick up whatever it missed.

**The listing a site shows you is not its catalogue.** `mizuno-asia` used to be enumerated
by rendering the 15 series pages the site links from its nav, which is what a person
browsing it would see. That found 75 products. The store's own
`store-products-sitemap.xml` lists 273 — a strict superset, containing every one of the 75
— because Wix generates it from the store rather than from the navigation. The 198 it adds
are the frames no series page links to any more: Altair T327 and T329, JPX 8 Power, Citius
71 and 73, Fortius 20, Duralite 69. Switching the source took Mizuno from 48 matched
rackets to 70, deleted the `browser-listing` adapter along with 15 Chromium page loads per
run, and left the browser doing only the job that genuinely needs it — reading a hydrated
gallery on a page a racket already matched.

**A sitemap carries URLs and no names.** That is its one weakness against a category
listing, and on `mizuno-asia` it is the whole remaining gap: with only the slug to match
on, the crawler is matching against whatever the shop's CMS made of the name when the page
was first created, not against what the page says today. Three of the 273 disagree with
their own slug — `/product-page/untitled` is the Acrospeed 1 Focus, `/duralite` is the
Duralite 66, and `/swifter-sp75` is titled SWIFTER SP76 — and no amount of slug matching
reaches those. Guessing at them is exactly what `match.ts` is built not to do.

So a `sitemap` source can set `titleFromHead`, which reads each product page's `og:title`
after the walk and hands it to the matcher alongside the slug. The titles are
server-rendered, so it is one plain GET per product and no browser, and the names are
cached with the URLs — paid once per `--refresh-sitemaps`, not once per run. A page that
fails to read keeps its slug and is no worse off than before. It picks up Duralite 66,
Swifter SP76 and Swifter SP78, none of which had an image from any source.

**A small brand can be the cheapest one to cover.** Hundred is 33 rackets against
Yonex's 570, and it took one config entry: `vn.hndrd.co` is the brand's own Shopify
build for Vietnam, and its `badminton-racket` collection returns all 48 rackets it sells
— galleries attached, 2084×2084 originals — from a single `products.json` request. No
product page is ever opened. 26 of the 33 match. Five of the seven that do not are frames
Vietnam does not stock; the other two are retailer editorial the manufacturer has no
reason to repeat ("Flareon 700 – Siêu phẩm phản tạt", "Nitrix Attack – Srikanth"), and an
alias for the second would file the standard Nitrix Attack's photographs under a signature
colourway this shop does not publish.

**The weight grade is left in the title on purpose.** Hundred sells most frames as two
products, one per grade — "Vợt cầu lông Nitrix 70 Volta - 3U" and "- 4U" — and `3U` is a
variant, not a model, so stripping it looks like the obvious `titleNoise` rule. Measured
against the live collection it trades one racket for nothing: with the grade gone the two
titles read alike, "Hyfonic 7" matches `hyfonic-7` and `hyfonic-7-4u` equally well and
is refused as ambiguous, while the sibling pages it would have won carry the same
photographs — `nitrix-70-volta` and `-3u` share all nine files, as do
`flareon-700`/`-3u` and `hyfonic-7`/`-4u`. Left in place, the grade reads as the SKU
fragment it looks like: the ungraded page wins outright where there is one, and where
every page carries a grade (`battle-900-3u`, `-4u`) they group as siblings and merge.

**META.vn is the case where that reasoning inverts**, and it is worth reading beside the
Hundred rule above rather than as a contradiction of it. What makes the grade harmless on
Hundred is that its permalinks say what its titles say: `hyfonic-7` and `hyfonic-7-4u`
differ by a trailing token short enough to read as a SKU, so the two pages group as one
product on the slug alone. META.vn's permalinks end in a per-product id
(`…-schock-solar-red-3u-do-den-p81517`, `…-4u-do-den-p81525`), which is exactly the kind
of token that says *different product*, so the grade cannot be left to the slug there —
the two pages of one racket read as two rackets and the match is refused as ambiguous.

Two things follow, and both are narrow on purpose:

- **`titleTransform`**, a provider hook that rewrites a listing name after `titleNoise`
  has run. META.vn writes the model, the grade and the colour into one string — "Adidas
  WUCHT P8 SCHOCK SOLAR RED 3U đỏ/đen" — and all three trail the model, which is the one
  position where the matcher forgives nothing but a SKU fragment. Rather than a second,
  worse copy of the colour vocabulary in regexes, the hook reuses the splitter the
  retailer scrape already runs on these same Vietnamese titles: it takes only a
  *trailing* run of known colour words and backs out the moment what remains stops naming
  a model. The grade comes off first, because it sits between the model and the colour
  here and would otherwise stop the colour walk dead at "RED".
- **Two candidates whose cleaned titles are identical are now grouped as one product**,
  on top of the slug rule. A shop that sells two frames under one name has a collision its
  own customers cannot resolve either, so this only ever joins groups and never splits
  one — a provider whose candidates carry no titles is untouched. Replayed against every
  provider's cached candidate list, it changed exactly one of 3299 racket-to-provider
  comparisons at the time it was added: the Wucht P8 Schock Solar, whose 3U and 4U pages
  stopped being rivals and became siblings whose galleries merge. It carries the Wucht P8
  Olympic's two pages as well, once the truncated grade below stops them reading as
  different names.

### Getting the biggest version of each image

Every extractor reaches past the size the page renders at, because the point of the crawl
is to stop depending on someone else's thumbnail:

- **Magento** (Yonex) — the `full` URL is the resize endpoint with empty dimensions, which
  returns the original upload: 2500×3750, against the 300×300 the retailer gave us.
- **Wix** (Mizuno Asia) — everything from `/v1/` onwards is a transform. Dropping it
  returns the upload, which is how a 273×273 grid thumbnail becomes a 4168×4167 original.
- **Shopify** — the `_600x600` size infix comes off the filename.

**Galleries come from structured data, not `<img>` tags.** A manufacturer's product page
holds 60–80 images, of which six are the product and the rest are the nav logo, four
technology diagrams, ten "you may also like" thumbnails and a payment-provider strip. So
each extractor reads what the page already publishes for its own front end: Magento's
gallery init block plus the swatch renderer's per-colour `jsonConfig.images`,
`__NEXT_DATA__` for Victor, the shop APIs where they exist, and schema.org `Product` or
OpenGraph as the generic fallback. The browser path is the one exception, and there the
filter is the browser's own `naturalWidth` — it has already decoded every image, so its
idea of how big each one is beats any guess from the filename.

### Matching is strict, and refuses rather than guesses

yonex.com serves product pages, series landing pages and eight years of press releases
from the same root path, so the candidates for "astrox 99" include `astrox-99-series`,
`astrox-99-pure-power` and `astrox-88-s-astrox-88-d-and-astrox-99-out-with-a-brand-new-look`.
A similarity score puts all of them within a few points of the real page, and the cost of
getting it wrong is another racket's photographs filed permanently under this racket's id.

So there is no similarity score. After the brand and template furniture come off, the
model name has to be a **prefix** of the candidate's tokens, in order, and whatever trails
it may only be SKU fragments — `astrox-99-pro-ax99-p` passes, `astrox-99-pure-power` does
not. Prefix rather than mere containment is what stops "Blizzard Pro New" taking the page
for "Blizzard Pro **ZZ** (New)": `zz` is short enough to look like a SKU, and containment
did not care that it sat *between* two model tokens rather than after them. Runs of single
letters are collapsed back into the initialism they came from, because Proace writes
`S.D.S 350` where the retailers write `SDS 350`. Where a source supplies a product name,
the name and the URL slug are both tried and the better result is kept.

**Where the space inside a model number goes.** Yonex prints `ASTROX 88 S PRO`; every
Vietnamese retailer, and so this catalogue, writes "Astrox 88S Pro". Those tokenise
differently and the strict comparison calls them different rackets — which cost the whole
ASTROX 88 D/S family, Yonex's best-selling doubles frames, their photography. So when the
strict comparison fails, both sides are re-cut at every letter/digit boundary (`88s` →
`88`,`s`) and compared once more.

That second pass has to clear a **higher** bar than the first: nothing may trail the model.
The two allowances do not compose — re-cutting `fx7` into `fx` + `7` manufactures exactly
the SKU fragment the trailing-token rule forgives, and stacking them hands "Promax FX" the
PROMAX FX7 page, "Astrox 22" the ASTROX 22RX and "Prototype X-1" the X1.2. Requiring the
re-cut to be exact keeps all 23 of the matches it wins — every one of them verified against
the name the manufacturer prints — and refuses those four. It also subsumes the Gosen alias
below: "Trivista GX800" now reaches `TRIVISTA GX 800` without one.

**Where the manufacturer and the catalogue disagree about the name.** Victor prints a code
on the frame — `ARS-100X`, `TK-F`, `BRS-12` — and spells the name out on the web page:
Auraspeed 100X, Thruster F, Brave Sword 12. The catalogue holds both forms, because the
retailers it is built from do, and only the spelled-out form has a page at victorsport.com.
A provider can therefore declare `modelAliases`, the mirror of `titleNoise`: `titleNoise`
cleans up the shop's side of the comparison, `modelAliases` restates ours.

An alias is tried **only** after the name as written has already matched nothing, and it
goes through the same prefix comparison — an alias is a second question, not a lower bar,
and it can never displace a direct match. The run reports how many rackets were matched
that way rather than folding them into the exact count, and each one records the alias it
matched under in `--out`. Expanding Victor's codes takes it from 85 matched rackets to
104. Thruster and Jetspeed each get two readings, because Victor writes both "THRUSTER K
520" and "THRUSTER 220H II" and the code does not say which.

Five of the eight codes currently find something — `TK`, `JS`, `ARS`, `DX` and `BRS`.
`BS`, `HX` and `MX` find nothing, not because the expansion is wrong but because Victor
no longer publishes a page for any Brave Sword, Hypernano X or Meteor X frame the catalogue
still lists.

Where several pages *are* one racket, they are crawled together. Victor publishes one page
per colourway (`auraspeed-3200-a` through `-s`), each with that colour's own photography,
and the racket's gallery is all of them; the colour is read off the page's sole variant and
lands in `racket_images.colourway`. Pages are pooled round-robin rather than concatenated,
so `--max-images` trims the tail of each colour instead of dropping whole colours. Where
several pages are *different* rackets — the catalogue holds a model called simply "ARS",
which matches `ars-70f-a`, `ars-80x-c`, `ars-90k-5u-h` and `ars-100x-td` — the match is
refused and reported as ambiguous.

### Titles written for shoppers, not for a catalogue

Kumpoo is the first provider whose product titles are Vietnamese retail copy rather than
model names — "Vợt cầu lông Kumpoo AK7 II chính hãng" — and whose permalink is that same
copy slugified, so `vot`, `cau`, `long`, `chinh` and `hang` sit exactly where the
matcher expects the model to start. Nothing matches on the slug there and nothing will;
all nine matches are made on the title after `titleNoise` takes the shop's furniture off:
the phrase "vợt cầu lông" wherever it falls, "chính hãng" (genuine) and "cao cấp"
(premium).

What is deliberately left on is the per-product editorial — the Vietnamese gloss on a
model name ("Nebula Tinh Vân", "Tiger Wings hổ trắng"), the player a frame is named for
("K01 Lâm Nhất"), "bản mới" (new version), "giá rẻ" (cheap). Each would win at most one
racket and the last two would cost more than they win: "K520 Pro bản mới" and "LỖI NHẸ …
K520 Pro giá rẻ" — a B-grade unit — both collapse onto the plain "K520 Pro" that already
matches cleanly, and the collision is reported as ambiguous and refused. A rule that reads
one listing's copy is a guess wearing a regex.

**Some listings are not a page for any one racket, and `titleNoise` cannot say so.** Noise
is text to remove; this is a listing to refuse, and removing the text is exactly what makes
it match. Kumpoo sells three frames under one product — "Power Control E55LS, E57LS,
E58LS" — and because the matcher forgives a *trailing SKU fragment*, `E57LS, E58LS` reads
as this product's own code rather than as two other rackets. It matched, and the
photograph it matched to turned out to be a group shot of all three frames side by side:
the wrong racket's photography under a racket's id, arriving through the one door the
matcher leaves open. A provider can therefore declare `excludeTitle`, and candidates
matching it are dropped at discovery, before the matcher sees them. Kumpoo's is a comma
followed by another SKU code, which catches that listing and the "520AS, 520BS, CA-06"
starter set, and leaves a comma followed by Vietnamese prose alone.

**Kumpoo is also the one provider that reads stock**, through `inStockOnly` on its
`woocommerce-store` source. Stock is a fact about a shop on a Tuesday and not about a
racket, so it is off everywhere else — a discontinued frame's photography is still that
frame's photography. On this shop it earns its place: 13 of the 34 listings are out of
stock and they are the shelf the stale copy sits on, the Tết editions from two zodiac
years ago and the B-grade "LỖI NHẸ" unit among them. Reading it costs exactly one matched
racket, Pines, and takes the candidate list from 34 to 19.

**Nine of 133 is the honest ceiling here, and the reason is naming, not crawling.** The shop
publishes 34 distinct rackets and sells them as named editions — Houyi II, Nimbus,
Kevlamor 3, Lectra Like — while this catalogue's 133 Kumpoo rows come from Vietnamese
retailer listings and are overwhelmingly OEM codes: 60 of them are some form of "Power
Control E##L/LS/S". The two namespaces barely intersect, and no amount of title cleaning
bridges them. 23 of the shop's products are frames this catalogue does not hold under any
name at all.

**A site with no API and no sitemap is still readable, and Gosen is the proof.**
gosensports.com is a hand-built Laravel site: no product JSON, no store sitemap, nothing
but two rendered listing pages of twelve at `/vot-cau-long?page=N`. That is what
`category-pagination` is for, and the walk is three requests — page 1, page 2, and page 3
to learn there isn't one. Its product pages carry a schema.org `Product` block, so the
generic structured-data extractor reads them with no new code.

What it returns is **one photograph per racket, not a gallery** — the `image` array holds a
single studio shot, and everything else under `/upload/` on that page is the header logo
or a related-product card. Seven of the ten come back at 3000×3000 and 1.3–1.6 MB; three
were uploaded at 446×793 and are full-frame shots all the same. One shot is still the
difference between a spec page and a 300×300 retailer thumbnail, but this provider will
never fill a carousel and `--max-images` is not what limits it.

Ten of the catalogue's 13 Gosen rackets match, one of them only through `modelAliases`:
the catalogue writes "Trivista GX800" and the site writes "Trivista GX 800", so the alias
splits a letters-and-digits token into its two halves. The three misses are frames the
site names differently — "Mira Light" against our "Mira Light Aura", "Ryoga Musou" against
"Ryoga Muso Sunrise", "Ryoga Mugen Đền Vàng" against "Ryoga Mugen Pure" — and each would
need a guess about whether an edition suffix means a different racket. None was made.

### When the manufacturer's site is not a shop

Every other provider here reads a storefront, and a storefront is a list of things somebody
is selling. fz-forza.com sells nothing. It is FZ Forza's marketing site — WordPress, no
product post type, no product API, no schema.org block anywhere, and an `og:image` whose
url is missing a slash — and it publishes the 29 rackets the brand currently makes, each
with the specification FZ prints on the frame and no price at all.

That turned "add Forza images" into a different job, because 27 of those 29 rackets were
not in this catalogue to attach an image to. The catalogue's 31 Forza rows came in from
Vietnamese retailer listings and are the previous generation — Nano Force, Mega Speed,
Armortec — which FZ no longer publishes. Only Precision TI-X1 and TI-X5 appear on both
sides.

`scripts/scraper/forza-catalogue.ts` reads the site as catalogue rows rather than as
offers, and is deliberately not a `sites/` adapter: everything in `sites/` produces a
`NormalizedItem`, which is an offer with a racket implied behind it, and pushing a
priceless manufacturer page through that would mean inventing a seller and a price for
all 27.

```bash
npx tsx scripts/scraper/forza-catalogue.ts            # crawl and report, write nothing
npx tsx scripts/scraper/forza-catalogue.ts --sync-db  # upsert rackets and variants
```

What the site gives, and what becomes of it:

| Published | Column |
| --------- | ------ |
| `Item no. FZ262671` | the variant `sku`, verbatim — better than the one `generate-sql.ts` synthesises from a slug |
| `WEIGHT: 86g +/-2` | `weight_grams`, and the `weight_class` band it falls in |
| `BALANCE: HL / M / HH` | `balance_point_mm`, through a three-point mapping |
| `FLEXIBILITY: F / M / S / VS` | `shaft_flex` |
| `REC. TENSION: 36 lbs` | both ends of `max_tension`; FZ publishes one number, not a range |
| `SHAFT` / `FRAME` | `frame_material`, deduplicated — the two are usually the same lay-up |
| `Color: 1001 Black` | the variant `colourway`, FZ's colour code included |

**Balance is a class, not a measurement, and the mapping says so.** FZ publishes HL, M or
HH where the schema wants millimetres, so HL/M/HH become 288/295/302 — the middle of the
bands the Balance Ruler already draws. That is the same kind of estimate as the flat 295
every spec-less racket in this catalogue has carried since the first scrape, but keyed to
what the manufacturer actually says, which the 295 is not.

**Everything else unpublished gets the placeholder the rest of the pipeline already uses**
— `shaft_diameter_mm` 6.8, `frame_shape` isometric, `string_pattern` 22×21,
`play_style_tags` all-round, `skill_level` intermediate, `grip_size` G5. `HOLES` is read
and reported but has no column: a hole count is not a string pattern, and turning one into
the other would be a guess dressed as a measurement.

**And one field has no honest placeholder: `msrp`.** FZ lists no prices and no Vietnamese
retailer in this catalogue stocks these 27 frames, so they are written with `msrp` 0
rather than a number nobody quoted. The app reads `lowestPrice ?? msrp`, so **until an
offer exists they render as ₫0 and sort as the cheapest rackets in the catalogue**. The
run says so on the way out. Fixing it properly means a nullable `msrp` and a "price on
request" state, which is a schema and UI change rather than a scraper one.

**Rackets already in the catalogue are left alone entirely.** Precision TI-X1 and TI-X5
carry a price a shop actually quoted and an offer behind it; upserting over them would
trade that for this site's silence. The run names them and skips them.

**Two more things this site broke, both fixed generally.** Its sitemap wraps every `<loc>`
in CDATA, which the sitemap reader — anchored on "not a `<`" — could not see at all, so
the provider read as zero products rather than as a parse bug; that is now handled for any
WordPress SEO plugin that does the same. And since no extractor in the platform table
finds anything on a page with no structured data, a provider can now declare its own
`extractors`. Forza's is `wpUploadsGallery`, which keys on the manufacturer's own filename
convention: the photographs are the uploads named after the item number the page prints,
and everything else under `/wp-content/uploads/` there is the logo or a technology badge.

29 of the 30 matched rackets came back with three shots each, at 2000×2888 and larger. The
one that did not is HT Power 30-V2, a discontinued frame whose page is still in the
sitemap and still references three photographs — all three of which now 404 on FZ's own
server, through the CDN and directly. There is nothing to fetch, and the run reports it
rather than papering over it.

**Yonex needed the same treatment, for the opposite reason.** The gallery crawler matches
66 of the 77 racquets yonex.com publishes. The other 11 are the aluminium Muscle Power and
B-series beginners' frames, the two Isometric TR training racquets, the E13 pair and the
Muscle Power 2 Junior — frames no Vietnamese retailer in the scrape stocks, so there was
no row for their photography to hang off and `scrape:images` reported them unmatched every
run. `scripts/scraper/yonex-catalogue.ts` writes those rows, and follows every rule the
Forza importer set: real values where Yonex prints them, the pipeline's own placeholders
where it does not, `msrp` 0 with the run saying so, and existing rows never touched.

```bash
npx tsx scripts/scraper/yonex-catalogue.ts            # crawl and report, write nothing
npx tsx scripts/scraper/yonex-catalogue.ts --sync-db  # insert the rows we do not hold
```

Yonex publishes `Frame`, `Shaft`, `Flex`, `Weight / Grip`, `Stringing Advice`, `Length`,
`Color(s)` and `Item Code`, and publishes **balance for no frame on any of its three
sites** — so unlike Forza there is nothing to key a balance mapping to, and these 11 take
the flat 295 mm that 3025 of the catalogue's other rackets already carry. Two readings
needed care:

- **`Hi-Flex` is the flexible end of Yonex's range, not a stiff one.** The name describes
  how much flex the shaft has. Mapped to `flexible`; `Extra Stiff` is `extra-stiff`.
- **`U (105g and below)` is a ceiling, not a measurement**, and it is the only weight the
  four aluminium frames carry. The number kept is the 105 Yonex printed rather than a
  midpoint invented here — every candidate is a guess about a racket that weighs *at most*
  105 g, and only one of them is traceable to the page. `weight_class` has no U and U is
  Yonex's heaviest class, so it lands in 2U. All four are named at the end of the run.

**Whether the catalogue already holds a racket is a matching question, not an id lookup.**
The id is minted from Yonex's spelling and the catalogue's came from retailers: Yonex
prints `ASTROX 88 S PRO` and the catalogue holds `Astrox 88S Pro`, which are two different
ids for one frame. Checking by id inserts a second row for seven frames already here — the
whole ASTROX 88 D/S family plus NANOFLARE 1000 Z. So the importer asks `match.ts`, the
same reconciliation the gallery crawler uses, and inserts 11 rather than 18.

### The one retailer, and the two brands that needed it

The whole point of this module is to stop depending on shop photography: a shop re-shoots
what it sells, in its own box, at its own crop, and the same frame looks different on every
listing. Every provider above is a manufacturer property for that reason.

Kamito is the case that argues the other way, and it argues it on one fact: **the brand has
no site.** No official domain resolves. There is no manufacturer photography to prefer, so
the choice is not between a shop's pictures and the maker's — it is between a shop's
pictures and nothing. Adidas is the same argument from the other end: badminton there is a
licensed line, adidas.com sells shoes and shirts, and there is no racket catalogue on it to
read.

`meta-vn` reads meta.vn's badminton category twice, filtered to one brand each —
[Kamito](https://meta.vn/vot-cau-long-c524?brands=1851) and
[Adidas](https://meta.vn/vot-cau-long-c524?brands=264) — one page apiece, twelve listings
and five. Both counts come from the listings' own `ItemList`, and `maxPages` is 1 for that
reason and because the walker would otherwise append `?page=2` to a url that already
carries a query string. What makes it worth taking is that meta.vn is not re-shooting
anything: the images are the brand's own product renders on white at 1200×900 and up,
against the 300×300 crop the retailer scrape gives. And `racket_images.provider` records
`meta-vn` on all 77 rows, so a photograph from a shop is never mistaken for one from a
manufacturer.

11 of the catalogue's 20 Kamito rackets match, three to twelve shots each. The nine that
miss are frames meta.vn does not sell, plus two near-misses the matcher refuses on purpose:
the shop lists "HELIOS" where the catalogue holds "Helios 102", and "MERCURY" where the
catalogue holds both "Mercury" and "Mercury 1000" — the bare name takes the bare listing,
and the numbered ones are left alone rather than guessed at.

Adidas is a much thinner shelf: **3 of 60**, and those three are all five of the listings —
two frames published in two weight grades each, plus one more. Wucht P8 Olympic and Wucht P8
Schock Solar each merge their 3U and 4U pages (10 and 12 images); Wucht P6 Shock Cyan takes
8. The other 57 Adidas rackets have no source at all.

Getting all five took reading the shop rather than working around it, in two places. **Its
product names are truncated in its own database:** the 3U Wucht P8 Olympic is stored, and
served in its `<title>`, its `<h1>`, its og:title and its schema.org block, as "… OLYMPIC
White 3". A bare trailing digit is not a weight grade the way `3U` is, so `stripVariantTokens`
correctly leaves it alone and the "White" in front of it then blocks the match. The permalink
is the one place the grade survives whole — `…-olympic-white-3u-p81470` — so the digit is
dropped only when the url confirms what it is, which is why `titleTransform` is handed the
url as well as the name. Stripping any trailing 2–5 would be a guess, and "Astrox 2" is a
real racket.

**And its Wucht P6 needed the reduction applied to both sides.** The catalogue's row for
that frame is "Wucht P6 Shock Cyan New" — a Vietnamese retailer's "bản mới", which Adidas
never printed — while META.vn sells it as "Wucht P6 Shock Cyan", which the colour splitter
reduces to "Wucht P6 Shock". The two names disagree in both directions at once, so neither
hook could close it alone. `meta-vn` therefore declares `modelAliases` as well, dropping a
trailing "New" and then applying the *identical* reduction to the catalogue's name, so both
sides of the comparison are asked the same question. It stays an alias in every other
respect: tried only after the name as written has matched nothing, put through the same
strict prefix comparison, unable to displace a direct match. The plain "Wucht P6" the
catalogue also holds gets no alias — there is nothing to drop — so it cannot be pulled onto
a colourway's page by this. One racket in the run matches through it, and the report names
the alias it matched under.

**Its gallery needed reading too.** The product page's schema.org block carries exactly one
image, the hero, while the gallery beside it holds two to twelve more — so the generic
structured-data reader would have cost two thirds of the photography. `metaVnGallery` keys
on the shop's own naming instead (`<slug>-g.jpg` for the hero, `-1.jpg`, `-2.jpg` for the
rest, under a dated `/Data/image/` folder), skips the `/thumb/` resize proxy and the
`-600.jpg` square crop, and folds together the three spellings meta.vn uses for one file —
`media.meta.vn` and `meta.vn`, `/Data/image/` and `/Data/Image/` — which its own server
treats as the same file and which dedupe otherwise sees as two.

Guessing `-3.jpg`, `-4.jpg` and onwards is not safe here and is not done: meta.vn answers
a missing image with a 1×1 tracking gif and HTTP 200 rather than a 404, so an invented url
comes back looking like a successful download.

### Coverage, and the gaps

Ten of the catalogue's 36 brands are wired up across thirteen providers: the four largest
by racket count, plus Hundred, Kumpoo and Gosen, whose Vietnamese sites publish their whole
racket line in two or three requests, Forza, whose own site is not a shop and supplied the
rackets as well as the photographs, and Kamito and Adidas, neither of which has a racket
site and which are together the one brand pair here photographed by a retailer. Every other
brand was probed against its real site with browser headers before being written off:

| Brand | Rackets | Why there is no provider |
| ----- | ------- | ------------------------ |
| Li-Ning | 336 | li-ning.com is a corporate landing page linking out to Amazon and AliExpress; it publishes no catalogue. en.lining.com answers 403 to any non-browser client. |
| Fleet | 153 | fleet.com.my answers 503. |
| Proace | 112 | no official domain resolves. |
| Felet | 103 | no official domain resolves. |
| Kawasaki | 86 | kawasaki-sports.com is the OEM sportswear-fabric business, not the badminton brand — its 183 products are textiles. |
| Flypower, Ashaway, Babolat | 85–13 | sites are alive but publish neither a sitemap nor a product API, so the catalogue cannot be enumerated without guessing URLs. |
| Redson, Vicleo, Adonex, … | ≤30 | no resolvable official site. |

Shipping an adapter that has never parsed a real page would be worse than an honest gap,
so the registry carries what works and the run names what it skipped. Adding a brand whose
site does cooperate is a config entry in `providers.ts`, not new code — declare a
`catalogue` source and a `platform`, and the existing extractors handle it.

**The hero is denormalised.** The first stored image is written to `rackets.hero_image_url`
as well, so a card render needs no join; `racket_images` is the gallery behind it. Nothing
in the app reads the gallery yet — that is a UI change, not part of the crawl.

## Security

RLS is on for every table (`supabase/migrations/*_init.sql`). The catalogue is public and
read-only; only live offers are visible to anonymous users; sellers manage their own
offers and storefront copy but never their own tier; the watchlist is private; catalogue
writes are admin-only. Sellers do not create products — they attach an **offer** to a
catalogued variant, which is the decision that keeps the catalogue clean.

Storage follows the same shape. `racket_images` and the `racket-images%` buckets are
publicly readable and admin-only for writes — product photographs on a public catalogue
page, where signing every URL would mean the catalogue could not be statically rendered.
The crawler writes with the service-role key, which bypasses RLS; the publishable key
cannot write either the table or the bucket.

## Not built

Payments, order capture, seller application flow, admin moderation queue, review
submission, `/vs/[a]-vs-[b]` SEO pages, guide bodies (index only), dark mode.
