/**
 * venson.vn: turning a paragraph of Vietnamese sales copy into the model name
 * the catalogue holds, and refusing the listings that are a page for no one
 * racket.
 *
 * Every title in these fixtures is a real one, copied from the shop. That
 * matters more here than on the other providers: this entry is almost entirely
 * `titleNoise` and `vensonTitle`, and a rule that reduces an invented title
 * correctly has proved nothing.
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { discoverCandidates } from "./discover";
import { bestMatch, slugOfUrl, type MatchCandidate } from "./match";
import { providerById, type ProviderConfig } from "./providers";

const provider = providerById("venson-vn");

/** A listing title, put through the provider's own hooks in the crawler's order. */
function cleaned(title: string): string {
  let text = title;
  for (const pattern of provider?.titleNoise ?? []) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (provider?.titleTransform) text = provider.titleTransform(text, "");
  return text.replace(/\s+/g, " ").trim();
}

function candidateFor(title: string, slug: string): MatchCandidate {
  const url = `https://venson.vn/san-pham/${slug}/`;
  return { url, slug: slugOfUrl(url), title: cleaned(title) };
}

/* ------------------------------------------------------------------ reduction */

test("a listing title reduces to the frame the page is for", () => {
  for (const [title, name] of [
    // The plain shape: category, brand, model, then a sentence of copy. The
    // model ends where the Vietnamese begins.
    [
      "Vợt cầu lông VS Thunder 100 chính hãng dạ quang phát sáng, sợi carbon bền nhẹ 4U dành cho mọi người chơi",
      "Thunder 100",
    ],
    [
      "Vợt cầu lông VS Kriss Sword XP thiết kế độc đáo, sức mạnh bùng nổ, dòng sản phẩm cao cấp của thương hiệu VENSON",
      "Kriss Sword XP",
    ],
    // The brand written both ways, and in the middle of the title rather than
    // at an edge where `filterFurniture` could have taken it.
    [
      "Vợt cầu lông VS Po Fang chính hãng VENSON, tấn công tốc độ, full cacbon 4U, căng sẵn tặng quấn cán và túi đựng",
      "Po Fang",
    ],
    // The weight grade and grip run together, and a lay-up in Latin script that
    // would otherwise trail the model and fail the comparison.
    [
      "Vợt cầu lông VS Kongfu Rabbit chính hãng 4UG6 carbon graphite, vợt Venson thỏ vàng luyện tập thi đấu chuyên nghiệp",
      "Kongfu Rabbit",
    ],
    // A bare "carbon" that is the first word of the Vietnamese sentence, and a
    // bare "titan" in the same position. Both come off only because of what
    // follows them.
    [
      "Vợt cầu lông VS Turbo 300 chính hãng carbon bền nhẹ 4U căng sẵn công thủ toàn diện cho mọi người chơi",
      "Turbo 300",
    ],
    [
      "Vợt cầu lông VS Kirin 80 chính hãng titan 4U cao cấp, vợt kỳ lân sơn dạ quang phát sáng",
      "Kirin 80",
    ],
    // The Vietnamese gloss on a model name goes with the rest of the prose.
    [
      "Vợt cầu lông Venson VS Yutu 920 Thỏ Ngọc 4U công thủ toàn diện thích hợp cho mọi người chơi thể thao",
      "Yutu 920",
    ],
    // The gift-box packaging is not part of the name, and neither is the colour
    // this shop writes in Vietnamese after it.
    ["Vợt cầu lông VS Youlong Rồng Đỏ chính hãng Full Box", "Youlong"],
    ["Vợt cầu lông VENSON VS Koi full box giới hạn, phiên bản hộp quà tặng cao cấp", "Koi"],
    // Nothing but the furniture to take: the whole title is already the model.
    ["Vợt cầu lông VS K6 Kriss Sword X Limited", "K6 Kriss Sword X Limited"],
  ] as const) {
    assert.equal(cleaned(title), name);
  }
});

test("a material word the model itself is named after survives", () => {
  // The bare-word rules are bounded by a Vietnamese word following them, which
  // is the whole reason these two keep their names. "High Carbon Series" is
  // refused later, by `excludeTitle`, for being a series page — but it has to
  // arrive there intact, or the pattern would have nothing to recognise.
  assert.equal(
    cleaned("Vợt cầu lông VS High Carbon Series siêu nhẹ, lõi xốp chống rung, đánh mạnh và kiểm soát tốt hơn"),
    "High Carbon Series",
  );
  assert.equal(cleaned("Vợt cầu lông VS titan 1000 chính hãng"), "titan 1000");
});

test("a spaced dash ends the head, and a hyphen inside a name does not", () => {
  // The shop gives both spellings of one name on this page, and the matcher
  // forgives nothing after a model but a SKU fragment, so the second has to go.
  assert.equal(cleaned("Vợt cầu lông VS AP77 – Ace Power 77, tấn công siêu tốc độ"), "AP77");
  // Not a real listing — the point is that the rule cannot reach a model with a
  // hyphen in it, and the catalogue holds one ("V-Dragon").
  assert.equal(cleaned("Vợt cầu lông VS V-Dragon chính hãng"), "V-Dragon");
});

test("a title that opens in Vietnamese keeps the words it opens with", () => {
  // Two listings do, and cutting at the first diacritic would leave "Dây" while
  // skipping to the first Latin word would leave "Kirin" — which is a reel of
  // string wearing the Kirin 80's name. The run is kept so `excludeTitle` can
  // read what the shop said it was selling.
  assert.equal(
    cleaned("Dây cước vợt cầu lông VENSON VS Kirin siêu nảy đàn hồi trợ lực cao, thích hợp lối đánh tấn công chuyên nghiệp"),
    "Dây cước Kirin",
  );
  // And the other one, which keeps its colourway and is therefore refused by
  // `venson-catalogue.ts` rather than written as a row.
  assert.equal(
    cleaned("Vợt cầu lông Venson Rồng văn trắng, VS ACE Power 11 Max Dragon phiên bản giới hạn 4UG5"),
    "Rồng văn trắng ACE Power 11 Max Dragon",
  );
});

/* -------------------------------------------------------------------- refusal */

test("a listing that is a page for several frames, or for none, is refused", () => {
  const excludeTitle = provider?.excludeTitle;
  assert.ok(excludeTitle);
  const excluded = (title: string) => excludeTitle.some((pattern) => pattern.test(cleaned(title)));

  for (const title of [
    // Eleven assorted B-grade frames under one product ("thanh lí" is clearance).
    "Thanh lí vợt lỗi nhẹ: Youlong, Titan 7 Pro, Titan 1000, Mighty Lion, VS Tanjiro, VS Nezuko",
    // Badminton string, mis-filed in the racket category by the shop.
    "Dây cước vợt cầu lông VENSON VS Kirin siêu nảy đàn hồi trợ lực cao, thích hợp lối đánh tấn công chuyên nghiệp",
    // HC 898 and HC 890 under one product, with one photograph.
    "Vợt cầu lông VS High Carbon Series siêu nhẹ, lõi xốp chống rung, đánh mạnh và kiểm soát tốt hơn",
    // Four frames in the product's own `Phân loại` axis.
    "Vợt cầu lông VS Blade 7000/ 7100/ 7200/ 7300 chính hãng, nano carbon bền nhẹ, căng sẵn 10.5kg tặng quấn cán, túi vợt",
    "Vợt cầu lông VS Youth thiết kế đặc biệt dễ dàng dành cho người mới chơi, căng sẵn 8kg, tặng quấn cán và túi đựng",
    "Vợt VS Kimetsu no Yaiba (Thanh gươm diệt quỷ)",
  ]) {
    assert.ok(excluded(title), `${title.slice(0, 40)}… should be refused`);
  }

  // And every listing that is a page for one frame is kept, including the two
  // whose reduced names brush against the patterns above.
  for (const title of [
    "Vợt cầu lông VS Thunder 100 chính hãng dạ quang phát sáng, sợi carbon bền nhẹ 4U dành cho mọi người chơi",
    "Vợt cầu lông VENSON VS WOVEN 70X, vợt cân bằng dành cho người chơi chuyên nghiệp",
    "Vợt cầu lông VS Ultra Woven 88S dòng sản phẩm vợt cân bằng cao cấp, carbon 40T Mitsubishi 1K Woven",
    "Vợt cầu lông VS J Speed 700, vợt tấn công siêu tốc độ, carbon 30T Mitsubishi cao cấp",
    "Vợt cầu lông VS K6 Light chính hãng",
    "Vợt cầu lông VENSON VS Grandmaster, dòng vợt cao cấp dành cho lối chơi chuyên nghiệp",
  ]) {
    assert.equal(excluded(title), false, `${title.slice(0, 40)}… should be kept`);
  }
});

/* -------------------------------------------------------------------- aliases */

test("the code VS prints on a frame expands to the name the catalogue holds", () => {
  const aliases = (name: string) => provider?.modelAliases?.(name) ?? [];

  // The shop states this expansion itself, on the page titled "VS AP77 – Ace
  // Power 77".
  assert.deepEqual(aliases("Ace Power 77"), ["AP77"]);
  assert.deepEqual(aliases("ACE Power 11 Max"), ["AP11 Max"]);
  // Ultra Woven is a series word this shop writes on one page and drops on the
  // next, so the catalogue's fuller name is offered without it as well.
  assert.deepEqual(aliases("Ultra Woven 70X"), ["Woven 70X"]);
  // And a name with neither shape gets nothing: an alias is a second question,
  // not a lower bar.
  assert.deepEqual(aliases("Thunder 100"), []);
  assert.deepEqual(aliases("Ultra"), []);
});

/* -------------------------------------------------------------------- matching */

/** The listing, as the shop publishes it: title, and permalink-derived slug. */
const CANDIDATES: MatchCandidate[] = [
  candidateFor(
    "Vợt cầu lông VS Thunder 100 chính hãng dạ quang phát sáng, sợi carbon bền nhẹ 4U dành cho mọi người chơi",
    "vot-cau-long-vs-thunder-100-chinh-hang-da-quang-phat-sang",
  ),
  candidateFor(
    "Vợt cầu lông VS Kriss Sword XP thiết kế độc đáo, sức mạnh bùng nổ",
    "vot-cau-long-vs-kriss-sword-xp-thiet-ke-doc-dao",
  ),
  candidateFor("Vợt cầu lông VS AP77 – Ace Power 77, tấn công siêu tốc độ", "vot-cau-long-vs-ap77-ace-power-77"),
  candidateFor(
    "Vợt cầu lông VENSON VS WOVEN 70X, vợt cân bằng dành cho người chơi chuyên nghiệp",
    "vot-cau-long-venson-vs-woven-70x",
  ),
  candidateFor("Vợt cầu lông VS Youlong Đen chính hãng", "vot-cau-long-vs-youlong-den-chinh-hang"),
  candidateFor("Vợt cầu lông VS Youlong rồng trắng chính hãng", "vot-cau-long-vs-youlong-rong-trang-chinh-hang"),
  candidateFor("Vợt cầu lông VS Youlong rồng xanh chính hãng", "vot-cau-long-vs-youlong-rong-xanh-chinh-hang"),
];

test("a catalogue name reaches its page, by the name or by the code", () => {
  const match = (name: string) => {
    let result = bestMatch(name, "VS", CANDIDATES);
    if (!result) {
      for (const alias of provider?.modelAliases?.(name) ?? []) {
        result = bestMatch(alias, "VS", CANDIDATES);
        if (result) break;
      }
    }
    return result;
  };

  const thunder = match("Thunder 100");
  assert.ok(thunder);
  assert.equal(thunder.tier, "exact");
  assert.equal(thunder.rivals.length, 0);

  // Only through the alias: every page on this shop is titled with the code.
  const acePower = match("Ace Power 77");
  assert.ok(acePower, "Ace Power 77 should reach the AP77 page");
  assert.equal(acePower.candidate.title, "AP77");

  const woven = match("Ultra Woven 70X");
  assert.ok(woven, "Ultra Woven 70X should reach the WOVEN 70X page");
  assert.equal(woven.candidate.title, "WOVEN 70X");
});

test("three colour pages of one racket are its siblings, not a collision", () => {
  // The shop publishes Youlong in black, white and blue, each with its own
  // photography and each reducing to the same name. `bestMatch` merges
  // candidates whose cleaned titles agree, so the three are one product with
  // three pages — which is the difference between storing one colour of this
  // racket and storing the racket.
  const match = bestMatch("YouLong", "VS", CANDIDATES);
  assert.ok(match);
  assert.equal(match.tier, "exact");
  assert.equal(match.rivals.length, 0);
  assert.equal(match.siblings.length, 2);
});

test("a fuller catalogue name does not take a thinner page", () => {
  // "Kriss Sword XP Pro" is its own row in the catalogue and the shop does not
  // publish it. The model has to be a prefix of the candidate, so the XP page
  // is refused rather than handed to the Pro.
  assert.equal(bestMatch("Kriss Sword XP Pro", "VS", CANDIDATES), null);

  // A bare "Kriss Sword" is the other direction, and it does reach the page —
  // `XP` is two characters and therefore code-like, which is the SKU-suffix
  // allowance the matcher makes on the candidate side everywhere. It reaches it
  // as `coded` rather than `exact`, so the row that names the frame outright
  // wins the page when `resolvePageOwnership` puts the two claims side by side.
  const series = bestMatch("Kriss Sword", "VS", CANDIDATES);
  assert.ok(series);
  assert.equal(series.tier, "coded");
  assert.equal(bestMatch("Kriss Sword XP", "VS", CANDIDATES)?.tier, "exact");
});

/* ------------------------------------------------------------------ discovery */

test("the Store API answers with the whole gallery, so no product page is opened", async () => {
  assert.ok(provider, "the venson-vn provider is registered");

  const product = (id: number, name: string, slug: string, images: number) => ({
    id,
    name,
    slug,
    permalink: `https://venson.vn/san-pham/${slug}/`,
    images: Array.from({ length: images }, (_, index) => ({
      src: `https://venson.vn/wp-content/uploads/2025/09/${slug}-${index}.jpg`,
      name: `${slug}-${index}`,
    })),
    is_in_stock: index0InStock(id),
  });
  function index0InStock(id: number) {
    // One of the two is out of stock, and it is kept: stock is a fact about a
    // shop on a Tuesday, not about a racket.
    return id !== 990;
  }

  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/robots.txt")) return new Response("Not found", { status: 404 });
    if (url.includes("/products/categories")) {
      return new Response(JSON.stringify([{ id: 15, slug: "vot-cau-long", count: 3 }]), { status: 200 });
    }
    if (url.includes("/wp-json/wc/store/v1/products?")) {
      return new Response(
        JSON.stringify([
          product(989, "Vợt cầu lông VS Thunder 100 chính hãng dạ quang phát sáng", "vot-cau-long-vs-thunder-100", 8),
          product(990, "Vợt cầu lông VENSON VS WOVEN 70X, vợt cân bằng dành cho người chơi", "vot-cau-long-venson-vs-woven-70x", 5),
          // Refused at discovery, before the matcher sees it.
          product(1540, "Thanh lí vợt lỗi nhẹ: Youlong, Titan 7 Pro, Titan 1000", "thanh-li-vot-loi-nhe", 12),
        ]),
        { status: 200, headers: { "x-wp-totalpages": "1" } },
      );
    }
    return new Response("Not found", { status: 404 });
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
      result.candidates.map(({ title, images }) => ({ title, images: images?.length })),
      [
        { title: "Thunder 100", images: 8 },
        { title: "WOVEN 70X", images: 5 },
      ],
    );
    assert.equal(result.urlsSeen, 3, "the clearance listing was seen and then dropped");
    assert.ok(
      !requested.some((url) => url.startsWith("https://venson.vn/san-pham/")),
      "the gallery came with the product; no product page is fetched",
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(resolve("scripts/scraper/output/sitemaps/venson-vn.json"), { force: true });
  }
});
