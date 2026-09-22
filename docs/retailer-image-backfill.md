# Missing racket galleries from retailers

The retailer backfill checks VNB, FBShop, QV Badminton and HVShop for every
racket that had no gallery at planning time. Existing galleries, including
admin uploads and galleries on equivalent catalogue rows, are excluded. A frozen
plan keeps all four sources in scope when a run resumes after its first upload.
Manufacturer refreshes preserve the imported `retailer-*` gallery rows.

## Watermark removal

`--remove-watermarks` removes each shop's overlay from a downloaded image
before hashing, thumbnail generation, Storage upload and database insertion.
Collecting from multiple websites and removing watermarks do not establish
image reuse rights.

The default remover is the local service in `docker/watermark`. It runs on
loopback, needs no credentials and costs nothing per image, so it can be
pointed at the whole plan:

```powershell
npm run watermark:up                 # build and start it on 127.0.0.1:8770
npm run test:watermark-service       # the detector's own suite, inside the image
npm run images:watermark -- --check  # version, fingerprint and loaded templates
```

### How it decides what a watermark is

Each retailer's overlay is cropped once from one of that shop's own
photographs and committed under `docker/watermark/templates/<site>/`. The
service matches those templates by normalised correlation across a range of
scales, then verifies each candidate a second time over the template's ink
pixels alone — a flat patch of studio backdrop correlates well with a mostly
white template window and badly with its ink. Only the matched ink is
repainted, grown by a few pixels, using LaMa; the bounding box is not, because
a box around the VNB logo would also repaint the shaft it sits on.

Nothing is inferred. **An image where no template matches is returned
unchanged**, the import keeps its original bytes and format, and the report
records `watermarkRemoved: false` with `detections: 0`. That is a verified
answer rather than a fallback: an editor *failure* still aborts that image and
never publishes it unprocessed.

Thresholds are per retailer, because the shops do not behave alike, and every
number in `SITE_SETTINGS` is the measured span of real overlays:

| Shop | Stamped | Real matches | Setting |
| --- | --- | --- | --- |
| `vnb` | 4 of 22 sampled | 110-204 px, ink 0.63-1.00 | `min_ink 0.55`, `min_width 96` |
| `qvbadminton` | 10 of 10 | 123-184 px, ink 0.38-1.00 | `min_ink 0.30`, `min_width 96` |
| `fbshop` | 9 of 9 | 72-185 px, ink 0.47-1.00 | `min_ink 0.40`, `min_width 64` |
| `hvshop` | see below | 244 px, contrast 13-15 | `min_ink 0.40`, `min_width 96`, finer cut and wider growth |

VNB is the one that matters: most of its photographs carry no overlay at all,
so a loose detector would repaint clean product shots. Every false match on an
unstamped VNB photograph came in at 72 px or narrower while every real logo was
110 px or wider, which is why the width floor rather than the score separates
them.

Measured over 49 labelled photographs: **33 overlays found, 0 missed, and 0 of
the 16 unstamped photographs repainted.** Of the 33 repaints, 32 removed the
mark and one — an FBShop logo whose aspect ratio no single template scale fits
— left a faint outline.

### Checking the repaint

After repainting, the service re-runs detection on its own result and returns
anything still matching where an overlay was, as `residual`. The import
records it per image and the run summary lists `incompleteRemovals` by source
URL.

**This flags conservatively and is not a verdict.** A repainted patch is
smooth, and a smooth patch correlates with a mostly-blank template about as
well as a weak overlay did, so a clean result can still be flagged. On the
labelled set it named five of the 33 repaints, one of which was genuinely
incomplete. Treat a flag as "look at this image", not as "this failed" — it
narrows what needs a human eye, it does not replace one.

Adding a shop means adding a template crop, its reference width and its
settings — not loosening a threshold for everyone.

### HVShop: several overlays, and one that had to be estimated

HVShop was the expensive lesson. The first sample of it was drawn entirely
from one canvas size and suggested a single corner stamp on every photograph.
It actually uses **at least three different overlays**, and a canvas-stratified
sample found that two of them were invisible to the detector: a whole import
run repainted 42 of 648 HVShop images and published the rest with their marks
intact. **Sample across canvas sizes, not just across products.**

Its large overlay — a shuttle, "HVshop" and sweeping arcs across the middle of
the frame — could not be templated the usual way. It is far too pale for
intensity correlation to find (its window is dominated by the racket, not the
mark), and no photograph carries it clear of the product, so no crop of one
would do. It is instead **estimated from a collection**:

1. Band-pass each photograph's gradients — keep the faint edges an overlay
   leaves, and zero the strong ones a product leaves. Clipping is not enough:
   a racket outline saturates any clip and the stack locks onto the racket.
2. Correlate those maps against their own median, keep the photographs that
   score well, and repeat. This converges in three rounds and separates the
   carriers (0.76-0.99) from the rest (0.05 and below).
3. Take a high percentile of the carriers' intensities. The product is dark
   and moves; the overlay is constant. What is left is the overlay alone.

`docker/watermark/templates/hvshop/hvshop-large.png` is that estimate, and it
matches on `domain: "edges"` rather than grey levels. Measured on a
stratified sample: on 800x993 it found all eight carriers at exactly the same
position and removed every one; on 534x663 it removed seven of eleven. No
clean photograph was repainted on either.

Two HVShop overlays remain uncovered: a bottom-right placement on 534x663 and
a small wordmark with a droplet on their 1000x1241 masters. The same
estimation was tried on the droplet and locked onto grip similarity instead of
the mark, so it is **not** covered — those images still import with their
overlay. The procedure above is the one to repeat when covering them.

### Identity and caching

Edits are cached by source checksum, shop and processing configuration.
Concurrent duplicates and restarts reuse a verified result without another
call, including a verified "no overlay here". The processing id folds in the
backend, engine and pinned service version, so galleries produced by different
configurations can never extend one another. `--check` prints the service
fingerprint, a hash over its version, thresholds and template bytes; set
`WATERMARK_SERVICE_FINGERPRINT` to refuse to run against anything else.

Originals are archived locally and source URLs and retailer attribution remain
recorded. Damaged cache files, invalid output, excessive aspect-ratio changes
and service failures are rejected and never fall back to uploading an
unprocessed image. Inspect representative original/cleaned pairs before a full
import; the report carries both checksums and both paths.

### The generative editor

`WATERMARK_BACKEND=openai` selects the original `gpt-image-2` editor instead.
It rewrites the whole image through a model and charges per call, so it stays
available for a frame the templates do not cover but is no longer the default.
It needs `OPENAI_API_KEY` and a Python with the `openai` package:

```powershell
python -m venv .venv-watermarks
..venv-watermarksScriptspython.exe -m pip install -r scripts/scraper/images/requirements-watermark.txt
```

A standalone command uses the same processing code as the import:

```powershell
npm run images:watermark -- --input=path/to/original.jpg --out=path/to/cleaned.png --site=vnb
# Prints the configuration without contacting the service or writing:
npm run images:watermark -- --input=path/to/original.jpg --out=path/to/cleaned.png --dry-run
```

## Run

```powershell
npm run test:image-scraper
npm run typecheck
npm run watermark:up
npm run test:watermark-service

# Read Supabase and discover all four catalogues; no database or Storage writes.
npm run scrape:images:retailers -- --out=scripts/scraper/output/retailer-image-complete-plan.json

# Download and decode a sample without editing or uploading.
npm run scrape:images:retailers -- --plan=scripts/scraper/output/retailer-image-complete-plan.json --validate --limit=10

# Clean a small sample and inspect the cached originals and outputs.
npm run scrape:images:retailers -- --plan=scripts/scraper/output/retailer-image-complete-plan.json --validate --remove-watermarks --limit=3

# Process the entire frozen plan, upload cleaned images/thumbnails and map galleries.
npm run scrape:images:retailers -- --plan=scripts/scraper/output/retailer-image-complete-plan.json --apply --remove-watermarks

# Verify database ownership, paths, hero pointers and referenced Storage objects.
npm run images:audit
```

Credentials use the existing `.env`/`.env.local` configuration:
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
`SUPABASE_IMAGE_BUCKET` defaults to `racket-images`.
Set `REVALIDATE_URL` and `REVALIDATE_SECRET` to invalidate the deployed catalogue
cache immediately after import; otherwise the app refreshes on its normal schedule.

The default cap is 12 distinct images **per retailer**, interleaved across sources.
Use `--max-images-per-site=N`, `--concurrency=N` or `--limit=N` to bound a run.
There is no first-success fallback. Failed and unmatched sources are explicit in
the report. A site with no matching product cannot contribute a gallery.
Apply refuses a plan until discovery has completed for all four retailers.

Re-run the same `--plan=... --apply --remove-watermarks` command to resume. Only
rows created by that exact plan and processing configuration can be extended;
intervening galleries and staff edits are preserved. Gallery rows are inserted
individually after upload. A failed database insert can leave an unreferenced
object. No existing image or object is deleted. Retain the frozen plan and local
reports when resuming; generating a new plan excludes galleries already filled.

Plans, inventories, reports and the watermark cache live in the ignored
`scripts/scraper/output/` directory. `--out=<file>` overrides a plan/report path.
`--reuse-discovery` reuses completed local inventories when planning; omit it for
fresh discovery. The plan is tied to one Supabase project hostname.

FBShop's robots policy disallows the Store API. Discovery uses its public product
sitemaps, with gallery/title validation deferred to the matched product pages.
Other sites use public catalogue APIs or HTML. Requests respect robots rules,
rate limits, timeouts, size limits and a site/CDN allowlist, including redirects.
Matching retains signature, limited-edition, colour, year and generation
distinctions; uncertain matches stay empty.

## Session status — 2026-09-20

Branch: `codex/missing-racket-retailer-galleries`.
The completed plan is `scripts/scraper/output/retailer-image-complete-plan.json`.
It includes 2,407 missing canonical galleries and candidate matches for 1,763;
785 have candidates from multiple retailers. Discovery finished for VNB (2,389
products), FBShop (2,540), QV Badminton (274) and HVShop (990). Candidate matches
still require successful live title checks, downloads and image validation.

The local Python environment has the pinned OpenAI SDK installed. The 111 image
tests pass, including watermark cache, failure handling, EXIF orientation and
run-isolation tests, and TypeScript checking passes. A live sample validated 29
images across 10 rackets (10 VNB images and 19 FBShop images) without uploads.
Editor tests use a mocked API runner; they do not verify live watermark removal
quality.

The actual `--apply --remove-watermarks` command was attempted and stopped at
preflight because `OPENAI_API_KEY` is absent. No images were uploaded and no
gallery rows were changed. Add the key locally, validate sample edits, then run
the full apply and audit commands above.
