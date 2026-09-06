/**
 * feletsports.com: the flight-payload gallery reader, and the listing titles
 * the matcher has to make sense of.
 *
 * The fixtures are the shape of the real pages, trimmed. What each one is
 * standing in for is named in the test, because every branch here exists
 * because a real page on that store has it.
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { discoverCandidates } from "./discover";
import { sitegiantGallery } from "./gallery";
import { bestMatch, slugOfUrl, type MatchCandidate } from "./match";
import { providerById, type ProviderConfig } from "./providers";

const CDN = "https://cdn1.sgliteasset.com/feletint/images/product";
const PAGE = "https://www.feletsports.com/product/aero-carbon";

/**
 * Wrap a product record the way the store's page does: JSON inside a
 * JavaScript string literal, split across two `self.__next_f.push` calls, with
 * the rendered markup either side of it.
 */
function pageFor(product: unknown, chunks = 2): string {
  const literal = JSON.stringify(`…,"productDetail":${JSON.stringify(product)}}`);
  const body = literal.slice(1, -1);
  const cut = Math.floor(body.length / chunks);

  const pushes = [body.slice(0, cut), body.slice(cut)]
    .map((part) => `self.__next_f.push([1,"${part}"])`)
    .join(";");

  return `<html><head><meta property="og:image" content="${CDN}/product-1/cached/a_1_420x420.jpg"/></head>
    <body><img src="https://erp-image.sgliteasset.com/_next/image?url=${encodeURIComponent(`${CDN}/product-9/other.jpg`)}&w=640&q=100"/>
    <script>${pushes}</script></body></html>`;
}

function imageRow(folder: string, name: string, sortOrder: number) {
  return {
    image: `product/${folder}/${name}`,
    sort_order: sortOrder,
    visibility: "yes",
    image_url: `${CDN}/${folder}/${name}`,
    thumbnail_url: `${CDN}/${folder}/cached/${name.replace(".jpg", "_150x150.jpg")}`,
  };
}

test("SiteGiant gallery reads the product record out of a split flight payload", () => {
  // The carousel prints a wrap-around clone of the last shot before the first,
  // so document order is not gallery order. `sort_order` is, and shot 1 is the
  // hero that becomes `rackets.hero_image_url`.
  const html = pageFor({
    name: "AERO CARBON",
    images: [
      imageRow("product-1", "hero.jpg", 1),
      imageRow("product-1", "second.jpg", 2),
      imageRow("product-1", "third.jpg", 3),
    ],
    variants: [],
  });

  assert.deepEqual(sitegiantGallery(html, PAGE), [
    { url: `${CDN}/product-1/hero.jpg`, position: 0, colourway: undefined },
    { url: `${CDN}/product-1/second.jpg`, position: 1, colourway: undefined },
    { url: `${CDN}/product-1/third.jpg`, position: 2, colourway: undefined },
  ]);
});

test("SiteGiant gallery orders by sort_order, not by array order", () => {
  const html = pageFor({
    name: "WOVEN 888",
    images: [
      imageRow("product-2", "third.jpg", 3),
      imageRow("product-2", "hero.jpg", 1),
      imageRow("product-2", "second.jpg", 2),
    ],
  });

  assert.deepEqual(
    sitegiantGallery(html, PAGE).map((image) => image.url),
    [`${CDN}/product-2/hero.jpg`, `${CDN}/product-2/second.jpg`, `${CDN}/product-2/third.jpg`],
  );
});

test("SiteGiant variants carry their own colour, spelled either way", () => {
  const html = pageFor({
    name: "AERO CARBON",
    images: [imageRow("product-1", "hero.jpg", 1)],
    variants: [
      {
        name: "AERO CARBON-GOLD/3U",
        attributes: [
          { attribute: "TYPE", value: "3U" },
          { attribute: "COLOUR", value: "GOLD" },
        ],
        images: [imageRow("product-11", "gold.jpg", 1)],
      },
      {
        name: "AERO CARBON-BLUE/4U",
        attributes: [{ attribute: "COLOR", value: "BLUE" }],
        images: [imageRow("product-12", "blue.jpg", 1)],
      },
      // A variant with no colour and no shots of its own contributes nothing.
      { name: "AERO CARBON/2U", attributes: [{ attribute: "TYPE", value: "2U" }], images: [] },
    ],
  });

  assert.deepEqual(sitegiantGallery(html, PAGE), [
    { url: `${CDN}/product-1/hero.jpg`, position: 0, colourway: undefined },
    { url: `${CDN}/product-11/gold.jpg`, position: 1, colourway: "GOLD" },
    { url: `${CDN}/product-12/blue.jpg`, position: 2, colourway: "BLUE" },
  ]);
});

test("a page named for one colour attributes its whole gallery to that colour", () => {
  // The store publishes HYPERMAX RED and HYPERMAX BLUE as two products with no
  // COLOUR attribute between them. The colour is only in the name, and without
  // reading it there the two merge into one racket with ten unlabelled shots.
  const html = pageFor({
    name: "HYPERMAX RED",
    images: [imageRow("product-3", "one.jpg", 1), imageRow("product-3", "two.jpg", 2)],
  });

  assert.deepEqual(
    sitegiantGallery(html, PAGE).map((image) => image.colourway),
    ["RED", "RED"],
  );
});

test("a colour word that is part of the model name is not read as a colourway", () => {
  // `splitColourway` backs out when what remains stops naming a model, so a
  // frame actually called a colour keeps it.
  const html = pageFor({
    name: "WHITE",
    images: [imageRow("product-4", "one.jpg", 1)],
  });

  assert.equal(sitegiantGallery(html, PAGE)[0].colourway, undefined);
});

test("nothing outside the product's own record is collected", () => {
  // A product page carries four or five *other* products' photographs — the
  // Next.js image proxy tag in the fixture is one — and an <img> sweep would
  // file them under this racket's id. Reading `productDetail` cannot.
  const html = pageFor({
    name: "AERO CARBON",
    images: [imageRow("product-1", "hero.jpg", 1)],
  });

  assert.deepEqual(
    sitegiantGallery(html, PAGE).map((image) => image.url),
    [`${CDN}/product-1/hero.jpg`],
  );
});

test("a hidden image is skipped and a page with no payload yields nothing", () => {
  const hidden = pageFor({
    name: "WOVEN 999",
    images: [
      { ...imageRow("product-5", "shown.jpg", 1) },
      { ...imageRow("product-5", "hidden.jpg", 2), visibility: "no" },
    ],
  });
  assert.deepEqual(
    sitegiantGallery(hidden, PAGE).map((image) => image.url),
    [`${CDN}/product-5/shown.jpg`],
  );

  assert.deepEqual(sitegiantGallery("<html><body>no payload here</body></html>", PAGE), []);
  assert.deepEqual(
    sitegiantGallery(`<script>self.__next_f.push([1,"a:\\"productDetail\\":{oops"])</script>`, PAGE),
    [],
  );
});

/* ---------------------------------------------------------------- discovery */

const provider = providerById("felet");

test("the racquet collection is walked to exhaustion with the store's own names", async () => {
  assert.ok(provider, "the felet provider is registered");
  const source = Array.isArray(provider.catalogue) ? provider.catalogue[0] : provider.catalogue;
  assert.equal(source.kind, "category-pagination");

  // A product card: the image links to the same url with no text, and only the
  // heading anchor carries the name. Picking the wrong one leaves every
  // candidate nameless, and these permalinks match nothing on their own.
  const card = (title: string, slug: string) =>
    `<div class="single-product-box">
       <div class="product-image"><a href="/product/${slug}"><img alt="${title}"/></a></div>
       <div class="product-content"><h3><a href="/product/${slug}">${title}</a></h3>
         <a href="/product/${slug}"><span class="new-price">RM299.99</span></a></div>
     </div>`;

  const pages: Record<string, string> = {
    "https://www.feletsports.com/collection/racquet":
      card("HYPERMAX RED", "hypermax-red") + card("WOVEN 888", "woven-888"),
    "https://www.feletsports.com/collection/racquet?page=2": card(
      "NEO 722 WHITE/BLUE",
      "neo-722-whiteblue",
    ),
    // Past the end the store serves the grid furniture with no cards in it,
    // which is what stops the walk.
    "https://www.feletsports.com/collection/racquet?page=3": "",
  };

  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    // The store has no robots.txt: it redirects to a CDN path that answers 403,
    // which the reader treats as "no restrictions".
    if (url.endsWith("/robots.txt")) return new Response("Access Denied", { status: 403 });
    const body = pages[url];
    if (body === undefined) return new Response("Not found", { status: 404 });
    return new Response(`<div class="products-row">${body}</div>`, { status: 200 });
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
        // The colour is off the title already: `titleTransform` runs inside
        // discovery, so what the matcher later sees is the frame.
        { slug: "hypermax-red", title: "HYPERMAX" },
        { slug: "woven-888", title: "WOVEN 888" },
        { slug: "neo-722-whiteblue", title: "NEO 722" },
      ],
    );
    assert.ok(requested.includes("https://www.feletsports.com/collection/racquet?page=3"));
    assert.ok(
      !requested.includes("https://www.feletsports.com/collection/racquet?page=4"),
      "a page that adds nothing ends the walk",
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(resolve("scripts/scraper/output/sitemaps/felet.json"), { force: true });
  }
});

/* ------------------------------------------------------------------ mapping */

/** The listing title as the store writes it, put through the provider's hooks. */
function candidateFor(title: string, slug: string): MatchCandidate {
  const url = `https://www.feletsports.com/product/${slug}`;
  const cleaned = provider?.titleTransform?.(title, url) ?? title;
  return { url, slug: slugOfUrl(url), title: cleaned };
}

test("the store's colourway pages collapse onto one catalogue racket", () => {
  // Four products, one frame. The catalogue holds "Hypermax" with the colour on
  // the variant, which is where these belong too.
  const candidates = [
    candidateFor("HYPERMAX RED", "hypermax-red"),
    candidateFor("HYPERMAX BLACK", "hypermax-black"),
    candidateFor("HYPERMAX WHITE", "hypermax-white"),
    candidateFor("HYPERMAX BLUE", "hypermax-blue"),
    candidateFor("NEO 722 PURPLE/ROSE RED", "neo-722-purplerose-red"),
    candidateFor("AERO CARBON SNOW WHITE", "aero-carbon-snow-white"),
    candidateFor("AERO CARBON", "aero-carbon"),
  ];

  const hypermax = bestMatch("Hypermax", "Felet", candidates);
  assert.ok(hypermax);
  assert.equal(hypermax.tier, "exact");
  assert.equal(hypermax.rivals.length, 0);
  assert.equal(hypermax.siblings.length + 1, 4);

  // "SNOW WHITE" and "PURPLE/ROSE RED" are two colour runs the shared
  // vocabulary reads whole; half-reading either leaves a name that matches
  // nothing and costs the page.
  const aero = bestMatch("Aero Carbon", "Felet", candidates);
  assert.ok(aero);
  assert.equal(aero.rivals.length, 0);
  assert.deepEqual(
    [aero.candidate, ...aero.siblings].map((page) => page.slug).sort(),
    ["aero-carbon", "aero-carbon-snow-white"],
  );
});

test("a longer model name on the store is refused, not taken", () => {
  // Each of these is a different frame from the catalogue row that nearly
  // matches it, and taking one would put its photography under the other's id.
  const candidates = [
    candidateFor("NEVOW TJ 1000", "nevow-tj-1000"),
    candidateFor("WOVEN TJ 1000", "felet-woven-tj-1000"),
    candidateFor("F-FORCE SUPER LIGHT", "felet-f-force-super-light"),
    candidateFor("SAKURRA", "sakurra"),
    candidateFor("TRAINING SERIES 160g", "training-series-160g"),
  ];

  for (const model of ["Nevow TJ", "Woven TJ", "F-Force", "Sakura", "Training Series 140G"]) {
    assert.equal(bestMatch(model, "Felet", candidates), null, `${model} should not match`);
  }
});

test("the brand in a permalink is furniture, and the model still matches on it", () => {
  // Half the store's permalinks carry the brand — `felet-titanium-ti-88` — and
  // half do not. The catalogue name has to reach both.
  const candidates = [
    candidateFor("TITANIUM TI 88", "felet-titanium-ti-88"),
    candidateFor("WOVEN 888", "woven-888"),
  ];

  for (const [model, slug] of [
    ["Titanium Ti 88", "felet-titanium-ti-88"],
    ["Woven 888", "woven-888"],
  ] as const) {
    const match = bestMatch(model, "Felet", candidates);
    assert.ok(match, `${model} should match`);
    assert.equal(match.candidate.slug, slug);
    assert.equal(match.tier, "exact");
  }
});
