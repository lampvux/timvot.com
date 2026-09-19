# Accessibility findings

Found by the axe scan that `e2e/fixtures.ts` runs on every page the end-to-end
suite visits. Two were fixed in the same change that added the suite; one is a
design-system change and is baselined until it is made.

The baseline lives in `KNOWN_VIOLATIONS` in `e2e/fixtures.ts`. A rule in that
map does not fail the build; **every other serious or critical violation
does**, on every page, in both locales, at 1280px and 400px. The map is there
so the rest of the gate could be a hard gate from day one rather than being
switched off the first time it was inconvenient.

---

## Open

### `color-contrast` — the tertiary and disabled ink ramps

**Impact:** serious. 126 nodes on `/vi/rackets`, 40 on `/vi`, 13 on
`/vi/methodology`. Present on every page.

Two tokens are below the WCAG AA minimum of 4.5:1 at the sizes they are
actually used:

| token | value | on | ratio | needs |
|---|---|---|---:|---:|
| `--text-disabled` | `#93a09a` | `--bg-sunken` `#edf1ef` | 2.38 | 4.5 |
| `--text-disabled` | `#93a09a` | `--bg-card` `#f6f8f7` | 2.54 | 4.5 |
| `--text-tertiary` | `#6d7a73` | `--bg-sunken` `#edf1ef` | 3.93 | 4.5 |
| `--text-tertiary` | `#6d7a73` | `--bg-card` `#f6f8f7` | 4.20 | 4.5 |

It is the ramp, not any one component. `--text-tertiary` is the spec-label
colour, the meta-row colour and the seller-count colour; `--text-disabled` is
the image-placeholder label. Both are used at 11px, which is below the 14pt
threshold that would let 3:1 apply instead.

`--text-tertiary` at 4.20 is close enough that a small darkening fixes it —
roughly `#5f6b65` clears 4.5:1 on both surfaces. `--text-disabled` is a
deliberate "this is not readable content" signal and needs a decision rather
than a nudge: either darken it to pass, or give the things wearing it a
non-colour signal as well.

**Why it is not fixed here.** Changing two semantic aliases in
`src/app/globals.css` changes the look of every surface in the product, and the
tokens are documented as ported verbatim from the design system. That is a
design decision, not a test-automation one.

**To close it:** adjust the two tokens, run `npm run test:e2e`, and delete
`color-contrast` from `KNOWN_VIOLATIONS`. The suite will then fail if it comes
back.

---

## Fixed

### `select-name` — the catalogue sort control had no accessible name

**Impact:** critical, and only at mobile widths, which is why it had survived.

`SortSelect` renders its visible label as `hidden ... sm:inline`. Below the
`sm` breakpoint that span contributes no text, the wrapping `<label>` therefore
contributes no accessible name, and the control reaches a screen reader as an
unnamed `<select>` — a list of options with nothing saying what they sort.

Fixed in `src/components/filter-rail.tsx` by giving the `Select` an
`aria-label` that does not depend on the breakpoint.

### `definition-list` — `<dl>` rows on `/methodology` were not `dt`/`dd`

**Impact:** serious, 2 nodes.

`SpecRow` rendered `<div><span/><span/></div>`, and the methodology page wraps
those in a `<dl>`. A `<dl>` may only hold `dt`, `dd`, and `div`s that wrap
them, so the markup was invalid — and more to the point a screen reader lost
the pairing between each label and its value, which on that page is the entire
content: the axis weights, the review-tier weights and the review threshold.

Fixed in `src/components/ds/data.tsx`. `SpecRow` is used only on
`/methodology` and only inside a `<dl>`, so the change has no other caller.

---

## Not an accessibility finding, but found the same way

### An unknown racket answers `200`

`/vi/rackets/yonex/does-not-exist` renders the not-found state — the catalogue
empty-state copy and a link back — but the HTTP status is `200`, not `404`.

This is inherent to the rendering strategy rather than a mistake. Under Cache
Components an unlisted path serves its App Shell immediately, so `notFound()`
runs after the response has already been flushed and cannot change the status
line. The trade-off is deliberate elsewhere in the codebase: "an unlisted path
still serves an App Shell instantly, so prerendering fewer is a latency trade,
not a missing page."

The cost is that a search engine sees a `200` for every URL somebody has ever
mistyped. Closing it would mean resolving the racket's existence inside the
static shell, which is a rendering-strategy change.

`e2e/racket-detail.spec.ts` therefore asserts what a visitor gets — the
not-found state and a route back to the catalogue — rather than the status
code, with the reason written next to it.

---

## Two more, fixed while the suite was being written

Neither is an accessibility finding, but both were found by the same specs and
are worth recording next to them.

**A hydration mismatch on every racket detail page.** `ReviewDate` rendered a
relative date (`formatReviewDate`) on the server. "Three days ago" is relative
to *when it rendered*, and these pages are prerendered at build time and read
days later — so the server's text and the browser's text were guaranteed to
differ. React's response to a mismatch is not a warning: it discards the
server's HTML for the surrounding subtree and re-renders it client-side, which
here is the whole review list, on the page that has the most of them. The page
logged `Minified React error #418` on every load.

Fixed by rendering the absolute date in the HTML and swapping to the relative
form after mount, in `src/components/review-date.tsx`.

**The language switcher dropped the query string.** Switching from `vi` to `en`
on `/vi/rackets?brand=yonex&sort=price-asc` landed on `/en/rackets` — filters,
sort and page gone. Filters live in the URL precisely so a view survives being
shared; the switcher was the one control that threw them away. Fixed in
`src/components/language-switcher.tsx`.
