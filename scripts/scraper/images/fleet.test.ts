/**
 * fleet.vn: the permalink the matcher has to read, the gallery block it has to
 * stay inside, and the catalogue names it has to reach.
 *
 * The fixtures are the shape of the real pages, trimmed. What each one stands
 * in for is named in the test, because every branch here exists because a page
 * on that site has it.
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { discoverCandidates } from "./discover";
import { fleetVnGallery } from "./gallery";
import { isPlaceholderChecksum } from "./index";
import { bestMatch, type MatchCandidate } from "./match";
import { providerById, type ProviderConfig } from "./providers";

const provider = providerById("fleet-vn");
const LISTING = "http://fleet.vn/san-pham/vot-cau-long/89";

/* -------------------------------------------------------------------- slugs */

/** The provider's own reading of a permalink, which is what discovery stores. */
function slugFor(url: string): string {
  assert.ok(provider, "the fleet-vn provider is registered");
  const source = Array.isArray(provider.catalogue) ? provider.catalogue[0] : provider.catalogue;
  assert.equal(source.kind, "category-pagination");
  assert.ok(source.slugFromUrl, "fleet-vn reads its own slug out of the url");
  return source.slugFromUrl(url);
}

test("a permalink reduces to the racket, not to the id and not to the shop's copy", () => {
  // `/chi-tiet-san-pham/<title slugified>/<id>`. The default `slugOfUrl` would
  // take "220", and the segment before it carries three tokens of category copy
  // and the brand ahead of the model.
  for (const [url, slug] of [
    ["http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-triotec-t6/220", "triotec-t6"],
    ["http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-woven-ice/353", "woven-ice"],
    ["http://fleet.vn/chi-tiet-san-pham/vot-cl-fleet-power-volt-7710/359", "power-volt-7710"],
    // No brand in this one, and nothing but the category comes off.
    ["http://fleet.vn/chi-tiet-san-pham/vot-cl-magic-fx100/358", "magic-fx100"],
    ["http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-jr-1-iii/245", "jr-1-iii"],
  ] as const) {
    assert.equal(slugFor(url), slug);
  }
});

test("only a leading category and brand come off, and only in that order", () => {
  // Both strips are anchored at the front, so a model carrying either word in
  // its own name keeps it. Neither case exists on the site today; the point is
  // that the rule cannot reach one when it appears.
  assert.equal(
    slugFor("http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-power-fleet/1"),
    "power-fleet",
    "the brand is taken once, where the category was",
  );
  assert.equal(
    slugFor("http://fleet.vn/chi-tiet-san-pham/vot-cau-long-woven-500/232"),
    "woven-500",
    "a listing with no brand in it keeps every model token",
  );
});

/* ---------------------------------------------------------------- discovery */

test("the pager writes its page number into a path segment", () => {
  assert.ok(provider);
  const source = Array.isArray(provider.catalogue) ? provider.catalogue[0] : provider.catalogue;
  assert.equal(source.kind, "category-pagination");
  // Not `?page=2`: this one is `…/89/page=2`.
  assert.equal(source.pagePath, "page={page}");
  assert.equal(source.pageParam, undefined);
});

test("the listing walk reads the grid, skips the sidebar, and stops when a page repeats", async () => {
  assert.ok(provider, "the fleet-vn provider is registered");

  // A grid card. The image above the name links to the same url with no text,
  // and the "sản phẩm mới nhất" sidebar links four products on every page with
  // a bare anchor — counting either would double every racket in the walk.
  const card = (title: string, slug: string, id: number) =>
    `<div class="col-md-3"><div class="product 1">
       <a href="/chi-tiet-san-pham/${slug}/${id}"><img src="/Upload/product/${id}.jpg"/></a>
       <div class="info">
         <a class="name" href="/chi-tiet-san-pham/${slug}/${id}">${title}</a>
         <p class="price">Giá : 1,680,000 VNĐ</p>
       </div>
     </div></div>`;

  const sidebar = `<div class="list-produt-sidebar"><ul><li>
      <a href="/chi-tiet-san-pham/vot-cl-magic-fx100/358"><img src="/Upload/product/358.jpg"/></a>
    </li></ul></div>`;

  const pages: Record<string, string> = {
    [LISTING]:
      card("Vợt cầu lông Fleet Triotec T6", "vot-cau-long-fleet-triotec-t6", 220) +
      card("Vợt Cầu lông FLEET GUARDIAN", "vot-cau-long-fleet-guardian", 342),
    [`${LISTING}/page=2`]: card("Vợt CL Guardian", "vot-cl-guardian", 356),
    // Past the end this site clamps to the last page rather than 404ing, so the
    // walk has to notice that a page added nothing new.
    [`${LISTING}/page=3`]: card("Vợt CL Guardian", "vot-cl-guardian", 356),
  };

  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    // fleet.vn serves no robots.txt; a 404 is read as no restrictions.
    if (url.endsWith("/robots.txt")) return new Response("Not found", { status: 404 });
    const body = pages[url];
    if (body === undefined) return new Response("Not found", { status: 404 });
    return new Response(`${sidebar}<div class="product-list"><div class="row">${body}</div></div>`, {
      status: 200,
    });
  };

  try {
    const result = await discoverCandidates(provider as ProviderConfig, {
      userAgent: "ShuttlecraftImageBot/1.0",
      timeoutMs: 1_000,
      delayMs: 0,
      refresh: true,
      verbose: false,
    });

    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.candidates.map(({ slug, title }) => ({ slug, title })),
      [
        // The category copy and the brand are off both sides now: `titleNoise`
        // takes them out of the title and `slugFromUrl` out of the permalink,
        // and the two say the same thing.
        { slug: "triotec-t6", title: "Triotec T6" },
        { slug: "guardian", title: "GUARDIAN" },
        { slug: "guardian", title: "Guardian" },
      ],
    );
    assert.ok(requested.includes(`${LISTING}/page=3`));
    assert.ok(!requested.includes(`${LISTING}/page=4`), "a page that adds nothing ends the walk");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(resolve("scripts/scraper/output/sitemaps/fleet-vn.json"), { force: true });
  }
});

/* ------------------------------------------------------------------ mapping */

/** A listing as the site publishes it, put through the provider's own hooks. */
function candidateFor(title: string, slug: string, id: number): MatchCandidate {
  const url = `http://fleet.vn/chi-tiet-san-pham/${slug}/${id}`;
  let cleaned = title;
  for (const pattern of provider?.titleNoise ?? []) cleaned = cleaned.replace(pattern, " ");
  return { url, slug: slugFor(url), title: cleaned.replace(/\s+/g, " ").trim() };
}

test("the site's two spellings of one racket collapse into one product", () => {
  // Guardian is published twice, once under each permalink shape. `bestMatch`
  // groups by `productKey(slug)`, so with the shop's copy left on those slugs
  // the two read as different rackets called Guardian and the match is refused
  // as ambiguous.
  const candidates = [
    candidateFor("Vợt Cầu lông FLEET GUARDIAN", "vot-cau-long-fleet-guardian", 342),
    candidateFor("Vợt CL Guardian", "vot-cl-guardian", 356),
  ];

  const match = bestMatch("Guardian", "Fleet", candidates);
  assert.ok(match, "Guardian should match");
  assert.equal(match.tier, "exact");
  assert.equal(match.rivals.length, 0, "two pages of one racket, not a collision");
  assert.equal(match.siblings.length, 1);
});

test("the catalogue's name reaches a page the shop spells with the category on it", () => {
  // Nothing here is matched on the id, and nothing survives of the shop's copy
  // on either side — which is the whole reason these match at all.
  const candidates = [
    candidateFor("Vợt cầu lông Fleet Triotec T6", "vot-cau-long-fleet-triotec-t6", 220),
    candidateFor("Vợt cầu lông Fleet Triotec T8", "vot-cau-long-fleet-triotec-t8", 219),
    candidateFor("Vợt cầu lông Fleet Triotec T6 II", "vot-cau-long-fleet-triotec-t6-ii", 216),
    candidateFor("Vợt cầu lông Fleet Woven ICE", "vot-cau-long-fleet-woven-ice", 353),
  ];

  for (const [model, slug] of [
    ["Triotec T6", "triotec-t6"],
    ["Triotec T8", "triotec-t8"],
    ["woven ICE", "woven-ice"],
  ] as const) {
    const match = bestMatch(model, "Fleet", candidates);
    assert.ok(match, `${model} should match`);
    assert.equal(match.tier, "exact");
    assert.equal(match.candidate.slug, slug);
    assert.equal(match.rivals.length, 0);
  }
});

test("a catalogue name the retailer's year rule shortened still reaches its page", () => {
  // `normalizer.ts` strips a trailing four-digit number as a season, and Fleet
  // names a whole family after one — so the catalogue holds "Speed FT" for the
  // frame this site publishes as Speed FT2000. The alias is tried only after the
  // name as written has matched nothing.
  const candidates = [
    candidateFor("Vợt cầu lông Fleet Speed FT2000", "vot-cau-long-fleet-speed-ft2000", 260),
    candidateFor("Vợt cầu lông Fleet Pulse FT 2000", "vot-cau-long-fleet-pulse-ft-2000", 247),
    candidateFor("Vợt cầu lông Fleet Dura FT 1500", "vot-cau-long-fleet-dura-ft-1500", 285),
  ];

  for (const [model, slug] of [
    ["Speed FT", "speed-ft2000"],
    ["Pulse FT", "pulse-ft-2000"],
  ] as const) {
    assert.equal(bestMatch(model, "Fleet", candidates), null, `${model} matches nothing as written`);

    const aliases = provider?.modelAliases?.(model) ?? [];
    const match = aliases.map((alias) => bestMatch(alias, "Fleet", candidates)).find(Boolean);
    assert.ok(match, `${model} should reach a page through an alias`);
    assert.equal(match.candidate.slug, slug);
  }

  // "Dura FT" gets the same alias and still matches nothing, because the Dura
  // family is FT 1500/2500/3500/5500 and there is no Dura FT2000. Refusing is
  // the right answer, not a near miss to be forgiven.
  for (const name of ["Dura FT", ...(provider?.modelAliases?.("Dura FT") ?? [])]) {
    assert.equal(bestMatch(name, "Fleet", candidates), null);
  }
});

test("a listing selling several frames is refused before the matcher sees it", () => {
  // Two pages sell three and four frames each, and the photograph on them is the
  // group shot. The catalogue holds all seven separately, so the listing is a
  // page for none of them.
  const excludeTitle = provider?.excludeTitle;
  assert.ok(excludeTitle);
  const excluded = (title: string) => excludeTitle.some((pattern) => pattern.test(title));

  assert.ok(excluded("Vợt CL Fleet 900 Tour, 900 Max, 900 Pro"));
  assert.ok(excluded("Vợt CL Fleet Starshine, Brand FR18, Max Speed, Arsas FR18"));
  // No Fleet model name carries a comma — the site writes "Woven Mach 5.1" and
  // "JR-1 III" — so nothing else is caught by it.
  for (const kept of ["Woven Mach 5.1", "JR-1 III", "Triotec T6", "Max Power 8810"]) {
    assert.equal(excluded(kept), false, `${kept} should be kept`);
  }
});

/* ------------------------------------------------------------------ gallery */

test("fleet.vn gallery takes the product's own shots and none of the page's other rackets", () => {
  // Trimmed from http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-fx-slash-500/253.
  // Three blocks on that page serve /Upload/product/ files: the sidebar of newest
  // products, the product itself, and the related-products rail underneath. Only
  // the middle one is this racket.
  const html = `
    <div class="list-produt-sidebar">
      <ul><li><a href="/chi-tiet-san-pham/vot-cl-magic-fx100/358">
        <img data-size="4x4" src="/Upload/product/sidebar-other-racket.jpg" />
      </a></li></ul>
    </div>
    <div class="row" id="product-detail">
      <div>
        <div class="col-md-5 left">
          <img src="/Upload/product/FX-Slash-500.gif" style="width: 100%;" alt="Alternate Text" />
        </div>
        <div class="col-md-7 detail"><p class="pro-name"><span>Tên sản phẩm :</span></p></div>
      </div>
      <div class="col-md-12"><div class="tab-content">
        <div role="tabpanel" class="tab-pane active" id="profile"><div><div class="image-list">
          <div class="col-md-3">
            <div class="gallery" data-src="/Upload/product/fx-slash-500-detail-1.jpg">
              <img data-size="4x4" src="/Upload/product/fx-slash-500-detail-1.jpg" />
            </div>
          </div>
          <div class="col-md-3">
            <div class="gallery"><img data-size="4x4" src="/Upload/product/fx-slash-500-detail-2.jpg" /></div>
          </div>
        </div></div></div>
      </div></div>
    </div>
    <div class="row" id="product-list-relative">
      <div class="product-list"><div class="product">
        <a href="/chi-tiet-san-pham/vot-cau-long-fleet-fx-flash-700/252">
          <img data-size="4x4" src="/Upload/product/related-other-racket.png" /></a>
      </div></div>
    </div>
    <div class="footer"><img src="/Content/images/logo-mini2.png" /></div>
  `;

  assert.deepEqual(
    fleetVnGallery(html, "http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-fx-slash-500/253"),
    [
      // A `.gif` name with PNG bytes behind it is this site's normal state for an
      // older hero, so the extension list has to admit it.
      { url: "http://fleet.vn/Upload/product/FX-Slash-500.gif", position: 0 },
      { url: "http://fleet.vn/Upload/product/fx-slash-500-detail-1.jpg", position: 1 },
      { url: "http://fleet.vn/Upload/product/fx-slash-500-detail-2.jpg", position: 2 },
    ],
  );
});

test("fleet.vn gallery is empty on a page with no product block", () => {
  const html = `<div class="product-list"><div class="product">
    <img src="/Upload/product/listing-card.jpg" /></div></div>`;
  assert.deepEqual(fleetVnGallery(html, "http://fleet.vn/san-pham/vot-cau-long/89"), []);
});

/* -------------------------------------------------------------- placeholder */

test("the brand logo the site serves as a photograph is refused by content", () => {
  // fleet.vn names every upload with a GUID, so `NON_PRODUCT` — which reads the
  // filename — cannot see this one, and it clears --min-pixels at 330×330. Ten
  // product pages with no photograph of their own serve the Fleet wordmark from
  // the same /Upload/product/ folder as the real shots, and storing it put a
  // logo under ten rackets' ids as though it were the frame.
  for (const checksum of [
    "ae834033973839fc92b63cb5becbd6299df6e41f4e7fb250b77365ac4f201c12",
    "8b6a8b5555dc23240a708d0d197cc0b193f3fe8ac351eac2703ac93db768f640",
  ]) {
    assert.equal(isPlaceholderChecksum(checksum), true);
  }

  // Only those bytes. The rule is a hash so that it cannot reach anything else —
  // this is the hero of the FX Slash 500, from the same folder on the same site.
  assert.equal(
    isPlaceholderChecksum("ae834033973839fc92b63cb5becbd6299df6e41f4e7fb250b77365ac4f201c11"),
    false,
  );
});
