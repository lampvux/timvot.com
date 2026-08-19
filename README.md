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
```

| Flag | Default | What it does |
| ---- | ------- | ------------ |
| `--site=` | `all` | Comma-separated: `vnb`, `qvbadminton`, `fbshop`, `hvshop`, `shopee` |
| `--pages=` | all | Cap the listing pages per site |
| `--sample=` | `5` | Product pages opened in a browser per site during verification |
| `--no-verify` | off | Skip the browser pass |
| `--out=` | `scripts/scraper/output/rackets.json` | `--out=none` to skip the file |
| `--verify-only[=file]` | off | Re-run the browser checks against a saved scrape, without scraping again |
| `--sync-db` | off | Upsert brands, rackets, variants, sellers, offers and price points |
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
| `--provider=` | `all` | `yonex`, `victor`, `apacs`, `mizuno-asia`, `mizuno` |
| `--limit=` | all | Cap the rackets crawled this run |
| `--max-images=` | `12` | Images stored per racket, across all its colourway pages |
| `--max-pages=` | `6` | Colourway pages read per racket |
| `--min-pixels=` | `40000` | Drop anything smaller than 200×200 |
| `--bucket=` | `racket-images` | Or set `SUPABASE_IMAGE_BUCKET` |
| `--bucket-strategy=` | `shared` | `shared` = provider folders; `per-provider` = one bucket each |
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
| `woocommerce-store` | apacs | Name + full gallery, from the shop's own Store API. 453 rackets in 5 requests. |
| `shopify-collection` | mizuno | Name + full gallery from `products.json`. |
| `2beasy-category` | victor | Victor's storefront API. 245 current rackets in 2 requests. |
| `category-pagination` | yonex | The rendered "all racquets" listing, walked `?p=1…N`. |
| `browser-listing` | mizuno-asia | Chromium, for a site that ships no product links at all. |
| `sitemap` | victor | The long tail — discontinued models with no catalogue entry left. |

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

One bucket, `racket-images`, partitioned by provider:

```
racket-images/<provider>/<brand>/<model>/<nn>-<sha8>.<ext>
              yonex/yonex/astrox-77-pro/00-4d1f8c22.webp
              victor/victor/auraspeed-3200/03-15af485d.webp
              mizuno-asia/mizuno/acrospeed-001/00-8f31a07c.jpg
```

`--bucket-strategy=per-provider` shards it instead — `racket-images-yonex`,
`racket-images-victor` — with the provider dropped from the key, since it has become the
bucket. Either way one manufacturer's assets are one subtree, which is what makes "take
our photography down" a prefix delete rather than a query. The RLS policies in
`20260819000000_racket_images.sql` are written against the `racket-images%` prefix so
both layouts are covered, and `ImageStore` is an interface because whose object storage
holds a copy of someone else's asset is a deployment decision, not a crawler one.

Filenames carry the first eight characters of the content hash, so a re-crawl of the same
photograph writes the same key and overwrites itself instead of accumulating
`image-1.png`, `image-1-2.png`. The full sha256 is the dedupe key in `racket_images`,
keyed `(racket_id, checksum)` — manufacturers reuse one photograph across a model's
colourways and across regional sites, and URL comparison does not catch that because the
query string differs.

**A brand can have more than one provider.** Mizuno has two: `mizuno-asia`, the Wix site
covering the whole Asian line by series, and `mizuno`, the Malaysian Shopify store that
lists what Malaysia stocks today. They are separate providers rather than one merged
source, because that is what lets the storage tree and the report say which photograph
came from which property. `mizuno-asia` is declared first because it matches more than
twice as many rackets; the Shopify store then picks up whatever it missed.

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

Where several pages *are* one racket, they are crawled together. Victor publishes one page
per colourway (`auraspeed-3200-a` through `-s`), each with that colour's own photography,
and the racket's gallery is all of them; the colour is read off the page's sole variant and
lands in `racket_images.colourway`. Pages are pooled round-robin rather than concatenated,
so `--max-images` trims the tail of each colour instead of dropping whole colours. Where
several pages are *different* rackets — the catalogue holds a model called simply "ARS",
which matches `ars-70f-a`, `ars-80x-c`, `ars-90k-5u-h` and `ars-100x-td` — the match is
refused and reported as ambiguous.

### Coverage, and the gaps

Four of the catalogue's 36 brands are wired up across five providers, and they are the
four largest by racket count. Every other brand was probed against its real site with
browser headers before being written off:

| Brand | Rackets | Why there is no provider |
| ----- | ------- | ------------------------ |
| Li-Ning | 336 | li-ning.com is a corporate landing page linking out to Amazon and AliExpress; it publishes no catalogue. en.lining.com answers 403 to any non-browser client. |
| Fleet | 153 | fleet.com.my answers 503. |
| Kumpoo | 133 | kumpoo.com does not resolve. |
| Proace | 112 | no official domain resolves. |
| Felet | 103 | no official domain resolves. |
| Kawasaki | 86 | kawasaki-sports.com is the OEM sportswear-fabric business, not the badminton brand — its 183 products are textiles. |
| Flypower, Forza, Gosen, Ashaway, Babolat | 85–13 | sites are alive but publish neither a sitemap nor a product API, so the catalogue cannot be enumerated without guessing URLs. |
| Adidas | 60 | badminton is a licensed line with no catalogue site of its own. |
| Hundred, Redson, Vicleo, Kamito, … | ≤33 | no resolvable official site. |

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
