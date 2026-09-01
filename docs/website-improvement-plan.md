# Shuttlecraft website improvement plan

## Scope and design intent

This plan improves the Vietnamese-first used-badminton-racket marketplace without
discarding its strongest asset: a calm, data-literate design system that makes
specifications, price history, and seller verification credible. The goal is to
make the next version feel more useful in the first 10 seconds, easier to scan
when comparing products, and more decisive at the point of purchase.

The supplied desktop references cover the home page, racket detail page,
catalogue, and string catalogue. The live reference is `https://timvot-com.vercel.app/`.

## What to preserve

- Court-green as the trust/verification colour, cyan only for live price data,
  cork for used-gear context, and the restrained small-radius card system.
- Archivo for editorial/display text, Be Vietnam Pro for UI and Vietnamese body
  copy, and JetBrains Mono for values that users compare.
- The balance ruler, score bars, verified-seller signals, and price-history
  chart. These are product evidence, not decoration.
- Dense tables for catalogues on desktop, with 44px minimum tap targets and
  horizontally scrollable comparisons on mobile.

## Priority improvements

| Priority | Opportunity | Design direction | Success signal |
| --- | --- | --- | --- |
| P0 | The homepage hero explains the product but does not immediately route a buyer to a meaningful starting point. | Turn the finder card into a visible, step-based entry point; add two secondary pathways: browse by playing style and inspect live price drops. Keep one strong primary action. | More finder starts and more qualified racket-detail visits. |
| P0 | Catalogue product imagery can read as grey placeholders, which weakens trust in a visual shopping decision. | Use consistent transparent racket cut-outs over subtle court-green/cork surfaces; retain the current brand fallback only for genuinely missing images and label it as such. | Image-loaded rate, card-to-detail click-through, and lower bounce from catalogue pages. |
| P0 | The racket detail page has strong evidence but purchase choices arrive too far down a long column. | Add a compact, sticky desktop buy-summary beside the main content and a bottom mobile action bar showing the best verified offer, price, and stock. Keep the seller table as the source of truth. | Seller-offer clicks per detail view. |
| P1 | The interface mixes Vietnamese navigation and content with an English hard-coded home headline. | Localise every buyer-facing headline and action; retain English only when the user actively selects it. Establish copy rules for terms such as Court Score, balance, verified, and used condition. | No mixed-language strings in locale QA; improved task-completion feedback. |
| P1 | Comparison is available, but its value is not carried through enough of the browse-to-buy flow. | Make selected comparison count visible in the header/tray; surface short, explainable differences (weight, balance, price, seller count) in cards and detail pages. | Compare-starts and compare-to-seller-click conversion. |
| P1 | Catalogue and string tables are information-rich but make it hard to form a shortlist quickly. | Introduce a compact filter summary, applied-filter chips, result count, sort explanation, and an optional “best match” row driven by the finder answers. Preserve table scanning for expert users. | Filter use and fewer zero-result sessions. |
| P2 | Guides are useful but visually subordinate to shopping tasks. | Reframe guides as decision support near the relevant moment: buying used, choosing balance, checking authenticity, and choosing strings. | Guide open-to-next-action rate. |
| P2 | The current layout is quiet to the point that hierarchy can flatten on wide screens. | Introduce deliberate section rhythm: a stronger featured-data module, occasional soft surfaces, and a more purposeful empty state. Avoid decorative gradients, large shadows, or visual noise. | First-contentful action engagement and qualitative clarity feedback. |

## Recommended page concepts

### 1. Home — “find with evidence”

1. Keep the dark hero band, but make the finder a first-class interactive
   module with three visible decisions: level, preferred feel, and goal.
2. Add a small “today’s market” strip beneath the headline: listings tracked,
   verified sellers, and price drops. Each number should link to its evidence.
3. Keep four trending cards, but give the first card a featured treatment and
   ensure every card shows a real product cut-out, one differentiating spec,
   the price, and Court Score.
4. Replace the visually even lower two-column area with a clearer decision
   split: “price drops worth checking” and “buy with confidence” guide cards.
5. On mobile, show the finder action before the product rail and keep the
   bottom tab bar clear of any sticky purchase controls.

### 2. Racket catalogue — “shortlist in one pass”

1. Make the filter rail sticky on desktop and convert it to a bottom sheet on
   mobile. Show active filters and a clear-all action without losing position.
2. Add an explicit result count, default sort rationale, and a small
   “recommended for you” marker when finder preferences exist.
3. Standardise card media and reserve its aspect ratio so images never cause
   layout shift. A no-image card should say “Ảnh chưa có” rather than appear
   indistinguishable from a loading state.
4. Give comparison a persistent but quiet state: count, undo, and a single
   clear route to the comparison view.

### 3. Racket detail — “evaluate, then buy”

1. Group the title, verified version status, key specs, Court Score, and
   price range into a concise decision header.
2. Promote the balance ruler and its plain-language interpretation to the top
   evidence layer; it is the product’s most distinctive explanatory element.
3. Add a sticky offer summary with best verified price, condition, stock, and
   a “view offers” action. It must not claim scarcity unless the underlying
   stock is known.
4. Keep the string recommendation, but present it as a contextual aid after
   buyers understand the racket—not as a competing primary action.
5. Treat price history as an explanatory module: current price, 30/90-day
   delta, median, and a clear method link. Use cyan only for buyer-positive
   price drops and red for rises.

### 4. Strings — “choose by feel and compatibility”

1. Preserve the scannable table, then add a light novice mode that translates
   gauge, control, durability, and repulsion into playing outcomes.
2. Add quick paths for common choices: durable, all-round, control, and
   attacking. These should set transparent filters rather than hide the table.
3. Link compatible string suggestions from racket detail pages with a visible
   reason, not generic recommendations.

## Figma design handoff

Use the existing production-redesign file as the source of visual direction:
<https://www.figma.com/design/JKwb4lf8yfuksFNJoPrcRj/Timvot-%E2%80%94-Production-Redesign>

The generated, editable Figma Make prototype is:
<https://www.figma.com/make/zo52CFHa1TUf5z1b6Jz0t1/High-fidelity-web-prototype>

Create three desktop frames and their mobile equivalents in the Figma concept:

1. `01 Home — finder-first` — hero, live-market strip, featured trending
   product, price-drop panel, and buyer-confidence guide cluster.
2. `02 Catalogue — confident shortlist` — sticky filter rail, applied-filter
   state, image-complete cards, and compare tray.
3. `03 Detail — evaluate then buy` — decision header, balance explanation,
   sticky offer summary, seller offers, and price history.

Use the existing tokens from `src/app/globals.css`: green-900/700 for trust,
cyan-600 for live-data movement, cork-50/100 for used context, ink-50 page
surface, 4–10px radii, and the current type roles. Do not introduce an
unrelated gradient-heavy ecommerce visual language.

The Figma Make brief has been set to generate responsive Home and racket-detail
views with this structure and these tokens. When it completes, use its output
for critique and copy only the approved frames into the production-redesign
file; keep the existing `00 Cover` frame intact. The Figma connector hit the
Starter-plan MCP call limit, so no edits were made to the source design file.
When the limit is available, capture the live home, catalogue, and detail pages
as reference-only frames, create the three concept frames as editable
components, and use the project fonts (Archivo, Be Vietnam Pro, JetBrains
Mono).

## Delivery sequence

1. **Baseline and content audit (1–2 days):** record page-level funnel events,
   image coverage, localisation gaps, and mobile viewport screenshots.
2. **Figma concept and usability review (2–3 days):** build the three concepts,
   test five buyer tasks, and select one direction before implementation.
3. **Foundation work (2–3 days):** finish image fallbacks, localisation,
   analytics events, and reusable card/offer/compare states.
4. **High-impact implementation (4–6 days):** ship the homepage finder-first
   composition and catalogue shortlist flow behind a feature flag.
5. **Purchase confidence (3–5 days):** ship the detail-page decision header,
   sticky offer summary, and mobile purchase action bar.
6. **Validation and iteration (ongoing):** compare against baseline for finder
   starts, product-detail engagement, offer clicks, filtering, and Core Web
   Vitals. Run Vietnamese and English visual QA at 320px, 768px, 1024px, and
   1440px.

## Definition of done

- Every key task—find a suitable racket, filter the catalogue, compare two
  rackets, understand balance, and choose a verified offer—can be completed
  without relying on colour alone.
- Both locales are complete and use the intended type roles with Vietnamese
  diacritics intact.
- Card images, fallbacks, and skeletons are visually distinct; no grey media
  placeholder is mistaken for a loaded product image.
- Desktop and mobile sticky controls never overlap the existing top bar or
  mobile tab bar.
- The redesign preserves the established performance discipline: stable media
  dimensions, low client-side hydration, and no non-essential animation.
