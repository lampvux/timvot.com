/**
 * vssports.vn: the second VS source, and the one whose 121 listings had to
 * reconcile against 134 catalogue rows written by Vietnamese retailers.
 *
 * Every title, permalink and fragment of markup in these fixtures is real,
 * copied from a live listing. That matters here for the same reason it does on
 * venson.vn: this entry is `titleNoise`, `vssportsTitle` and `vssportsSlug`, and
 * a rule that reduces an invented title correctly has proved nothing.
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { discoverCandidates } from "./discover";
import { vssportsGallery } from "./gallery";
import { bestMatch, type MatchCandidate } from "./match";
import { providerById, type CatalogueSource, type ProviderConfig } from "./providers";
import { slugify } from "../normalizer";

const provider = providerById("vssports-vn");

function source(): Extract<CatalogueSource, { kind: "category-pagination" }> {
  const declared = Array.isArray(provider?.catalogue) ? provider?.catalogue[0] : provider?.catalogue;
  assert.ok(declared && declared.kind === "category-pagination");
  return declared;
}

/** A listing title, put through the provider's own hooks in the crawler's order. */
function cleaned(title: string): string {
  let text = title;
  for (const pattern of provider?.titleNoise ?? []) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (provider?.titleTransform) text = provider.titleTransform(text, "");
  return text.replace(/\s+/g, " ").trim();
}

function candidateFor(title: string, path: string): MatchCandidate {
  const url = `https://vssports.vn/${path}`;
  return { url, slug: slugify(source().slugFromUrl!(url)), title: cleaned(title) };
}

/* ------------------------------------------------------------------ reduction */

test("a listing title reduces to the frame the page is for", () => {
  for (const [title, name] of [
    // The plain shape: category, brand, model, and the shop's badge.
    ["Vợt Cầu Lông VS Hunter Chính Hãng", "Hunter"],
    ["Vợt cầu lông VS Blade 9200", "Blade 9200"],
    ["Vợt Cầu Lông VS One Piece Luffy Chính Hãng", "One Piece Luffy"],
    // "Set" is a frame sold with a bag and a grip. The bundle is the shop's, the
    // frame is the catalogue's.
    ["Set Vợt cầu lông VS Kirin 70", "Kirin 70"],
    ["SET Vợt Cầu Lông VS YouLong Đỏ Tết 2024", "YouLong"],
    // The brand written both ways, and in the middle of the title rather than at
    // an edge where `filterFurniture` could have taken it.
    ["Vợt cầu lông Venson VS Windsoul Fengling", "Windsoul Fengling"],
    // The model code keeps its own `VS`, because the noise pattern requires the
    // brand to stand alone as a word.
    ["Vợt Cầu Lông Venson Challenger VS630", "Challenger VS630"],
    // The Vietnamese tail comes off and the English colour stays — the catalogue
    // holds "Youlong Pink" as its own row.
    ["Vợt cầu lông VS Youlong Pink Rồng Hồng", "Youlong Pink"],
    ["Vợt cầu lông VS Youlong Silver Rồng Bạc", "Youlong Silver"],
    ["Vợt cầu lông VS JinLi Cá Koi", "JinLi"],
  ] as const) {
    assert.equal(cleaned(title), name, title);
  }
});

test("a spaced dash is kept, because on this shop it is part of the name", () => {
  // venson.vn needs the opposite rule — "VS AP77 – Ace Power 77" is one frame
  // named twice — but the only dashes here introduce the character a licensed
  // frame is named after, and the catalogue holds all four rows with that tail.
  assert.equal(
    cleaned("Vợt cầu lông VS Kimetsu no Yaiba 30 - Hashibira Inosuke"),
    "Kimetsu no Yaiba 30 - Hashibira Inosuke",
  );
});

/* ---------------------------------------------------------------------- slug */

test("the permalink reduces to the model, not to the category", () => {
  const slug = (path: string) => source().slugFromUrl!(`https://vssports.vn/${path}`);

  assert.equal(slug("vot-cau-long-vs-blade-9200.html"), "blade-9200");
  assert.equal(slug("vot-cau-long-vs-hunter-chinh-hang.html"), "hunter");
  assert.equal(slug("set-vot-cau-long-vs-kirin-70.html"), "kirin-70");
  assert.equal(slug("vot-cau-long-venson-vs-windsoul-fengling.html"), "windsoul-fengling");
  assert.equal(slug("vot-cau-long-venson-challenger-vs630.html"), "challenger-vs630");

  // Left as it is: the default would have read the whole Vietnamese category
  // plus `html` as the racket's identity, and `html` trails a model as a word
  // rather than as a SKU fragment, which the matcher refuses outright.
  assert.equal(slug("vot-cau-long-vs-one-piece-zoro-chinh-hang.html"), "one-piece-zoro");
});

/* -------------------------------------------------------------------- aliases */

test("a retailer's sales pitch comes off the catalogue's own name", () => {
  const aliases = (name: string) => provider?.modelAliases?.(name) ?? [];

  // Eight catalogue rows carry one, because the retailer they were scraped from
  // titled its listing that way.
  assert.deepEqual(aliases("Blade 7000 – Vợt cầu lông giá rẻ"), ["Blade 7000"]);
  assert.deepEqual(aliases("CHALLENGER 750 – Tự tin phạt cầu"), ["CHALLENGER 750"]);
  assert.deepEqual(aliases("Turbo125I – Giá cả cực chất bất ngờ"), ["Turbo125I"]);

  // Only when the tail is Vietnamese. These four rows' tails are the frame's own
  // name, and the shop prints them too.
  assert.deepEqual(aliases("Kimetsu no Yaiba 10 – Kamado Tanjiro"), []);
  // And a name with no dash at all gets nothing: an alias is a second question,
  // not a lower bar.
  assert.deepEqual(aliases("Blade 9200"), []);
});

/* -------------------------------------------------------------------- matching */

const CANDIDATES: MatchCandidate[] = [
  candidateFor("Vợt cầu lông VS Blade 9200", "vot-cau-long-vs-blade-9200.html"),
  candidateFor("Vợt cầu lông VS Blade 7000", "vot-cau-long-vs-blade-7000.html"),
  candidateFor("Vợt cầu lông VS Turbo 125I", "vot-cau-long-vs-turbo-125i.html"),
  candidateFor("Vợt cầu lông VS Youlong Pink Rồng Hồng", "vot-cau-long-vs-youlong-pink-rong-hong.html"),
  candidateFor("Vợt cầu lông VS Youlong Silver Rồng Bạc", "vot-cau-long-vs-youlong-silver-rong-bac.html"),
  candidateFor("Vợt cầu lông VS Dragon", "vot-cau-long-vs-dragon.html"),
  candidateFor("Set Vợt Cầu Lông VS Dragon", "set-vot-cau-long-vs-dragon.html"),
  candidateFor("Vợt Cầu Lông VS ARMOR POWER 7100", "vot-cau-long-vs-armor-power-7100.html"),
  candidateFor("Vợt Cầu Lông Venson Challenger VS800", "vot-cau-long-venson-challenger-vs800.html"),
];

function match(name: string) {
  let result = bestMatch(name, "VS", CANDIDATES);
  if (!result) {
    for (const alias of provider?.modelAliases?.(name) ?? []) {
      result = bestMatch(alias, "VS", CANDIDATES);
      if (result) break;
    }
  }
  return result;
}

test("a catalogue name reaches its page, by the name or through the alias", () => {
  const blade = match("Blade 9200");
  assert.ok(blade);
  assert.equal(blade.tier, "exact");
  assert.equal(blade.rivals.length, 0);

  // Only through the alias: the catalogue row still carries the retailer's pitch.
  const cheap = match("Blade 7000 – Vợt cầu lông giá rẻ");
  assert.ok(cheap, "the row should reach the Blade 7000 page");
  assert.equal(cheap.candidate.title, "Blade 7000");

  // The catalogue runs the letters and digits together where the shop spaces
  // them. `bestMatch` re-cuts both sides at the boundary, so this matches
  // without needing an alias for the join as well.
  const turbo = match("Turbo125I – Giá cả cực chất bất ngờ");
  assert.ok(turbo, "Turbo125I should reach the Turbo 125I page");
  assert.equal(turbo.candidate.title, "Turbo 125I");

  // Each colour is its own catalogue row and its own page, and they must not
  // collapse into one another.
  assert.equal(match("Youlong Pink")?.candidate.title, "Youlong Pink");
  assert.equal(match("Youlong Silver")?.candidate.title, "Youlong Silver");
});

test("the frame's own page and its bundle listing are one racket, not two", () => {
  // The shop sells the Dragon on its own and as a set, and both reduce to the
  // same name. `bestMatch` merges candidates whose cleaned titles agree, so this
  // is one product with two pages — which is two galleries of the same frame
  // rather than a collision the matcher has to refuse.
  const dragon = match("Dragon");
  assert.ok(dragon);
  assert.equal(dragon.rivals.length, 0);
  assert.equal(dragon.siblings.length, 1);
});

test("a thinner catalogue name does not take a fuller page", () => {
  // "ARMOR POWER" is its own row and the shop publishes only the 7100. A number
  // is not a SKU fragment the matcher forgives — `isCodeLike` wants a letter in
  // it — so the page is refused rather than handed to the bare name.
  assert.equal(match("ARMOR POWER"), null);
  // And "Challenger 800" is not "Challenger VS800". Whether VS means them to be
  // the same frame is not knowable from either side, so neither is told it is.
  assert.equal(match("Challenger 800"), null);
});

/* --------------------------------------------------------------------- gallery */

test("the gallery is the lightbox, and nothing else on the page is", () => {
  // The shapes a real product page puts on the wire, in the order it does.
  const html = `
    <meta property="og:image" content="https://cdn.vssports.vn/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg" />
    <div class="swiper-wrapper" id="lightgallery">
      <a class="swiper-slide" data-hash="0" href="/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg">
        <img src="/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg"
             data-image="/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg" />
      </a>
      <a class="swiper-slide" data-hash="1" href="/uploads/gallery/vot-cau-long-vs-9200-2_1774992199.jpg">
        <img src="/uploads/gallery/vot-cau-long-vs-9200-2_1774992199.jpg" />
      </a>
      <a class="swiper-slide" data-hash="2" href="/uploads/gallery/vot-cau-long-vs-9200-1_1774992204.jpg">
        <img src="/uploads/gallery/vot-cau-long-vs-9200-1_1774992204.jpg" />
      </a>
    </div>
    <div class="product-photo-thumbs swiper-wrapper">
      <div class="swiper-slide">
        <img src="/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg" />
      </div>
    </div>
    <div class="rte product_getcontent">
      <p><img src="https://vssports.vn/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg" /></p>
      <p>Ngoài ra, bạn cũng có thể xem thêm
        <a href="https://vssports.vn/vot-cau-long-vs-ultra-woven-70x.html">Vợt cầu lông VS Ultra Woven 70X</a>.
        <img src="/uploads/gallery/vot-cau-long-vs-ultra-woven-70x_1767830001.jpg" />
      </p>
    </div>
    <img width="50" height="50" data-src="/uploads/CamKetSanPham/product-policy-1_1770949057.webp" />
    <div class="product-name">
      <img data-src="/img/300x300/uploads/gallery/1000x1000-19_1787778172.png" />
    </div>
  `;

  const images = vssportsGallery(html, "https://vssports.vn/vot-cau-long-vs-blade-9200.html");

  assert.deepEqual(
    images.map((image) => image.url),
    [
      "https://vssports.vn/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg",
      "https://vssports.vn/uploads/gallery/vot-cau-long-vs-9200-2_1774992199.jpg",
      "https://vssports.vn/uploads/gallery/vot-cau-long-vs-9200-1_1774992204.jpg",
    ],
  );
  // The Ultra Woven 70X shot is the one that matters: it sits in the description
  // beside a link to its own page, in the same folder, named the same way. Only
  // the container tells it apart from this racket's photography.
  assert.ok(
    !images.some((image) => image.url.includes("ultra-woven-70x")),
    "another racket's photograph must not be filed under this one",
  );
});

test("a page with no lightbox yields nothing rather than sweeping the page", () => {
  assert.deepEqual(
    vssportsGallery(
      '<img src="/uploads/gallery/vot-cau-long-vs-9200_1774992193.jpg" />',
      "https://vssports.vn/vot-cau-long-vs-blade-9200.html",
    ),
    [],
  );
});

/* ------------------------------------------------------------------ discovery */

test("the listing is walked to the end, and stops when a page adds nothing", async () => {
  assert.ok(provider, "the vssports-vn provider is registered");

  const card = (title: string, path: string) =>
    `<h3 class="product-name"><a href="/${path}" title="${title}">${title}</a></h3>`;

  const page = (n: number) => {
    // 20 a page on the real shop; three here, and the seventh page holds one.
    if (n <= 2) {
      return [
        card(`Vợt cầu lông VS Blade ${n}000`, `vot-cau-long-vs-blade-${n}000.html`),
        card(`Vợt cầu lông VS Titan ${n}`, `vot-cau-long-vs-titan-${n}.html`),
      ].join("");
    }
    if (n === 3) return card("Set Vợt Cầu Lông VS Dragon", "set-vot-cau-long-vs-dragon.html");
    // Past the end, Bizweb clamps to the last page rather than 404ing, so the
    // walk has to stop on "added nothing" rather than on a status code.
    return card("Set Vợt Cầu Lông VS Dragon", "set-vot-cau-long-vs-dragon.html");
  };

  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/robots.txt")) return new Response("Not found", { status: 404 });
    const n = parseInt(new URL(url).searchParams.get("page") ?? "1", 10);
    return new Response(`<html><body>${page(n)}</body></html>`, { status: 200 });
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
      result.candidates.map(({ title, slug }) => ({ title, slug })),
      [
        { title: "Blade 1000", slug: "blade-1000" },
        { title: "Titan 1", slug: "titan-1" },
        { title: "Blade 2000", slug: "blade-2000" },
        { title: "Titan 2", slug: "titan-2" },
        { title: "Dragon", slug: "dragon" },
      ],
    );

    const listingPages = requested.filter((url) => url.includes("vot-cau-long.html"));
    assert.equal(listingPages.length, 4, "page 4 repeated page 3, so the walk stopped there");
    assert.ok(
      !requested.some((url) => /vot-cau-long-vs-/.test(url)),
      "discovery collects links; the gallery is read per racket afterwards",
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(resolve("scripts/scraper/output/sitemaps/vssports-vn.json"), { force: true });
  }
});
