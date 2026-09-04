import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { discoverCandidates } from "./discover";
import { woocommerceHtmlGallery } from "./gallery";
import { bestMatch, type MatchCandidate } from "./match";
import { providerById, type ProviderConfig } from "./providers";
import { SupabaseImageStore } from "./storage";

const PRODUCT_TITLES = [
  "Five Star",
  "Flash",
  "Fury 818",
  "Fury 838",
  "Fury 868",
  "Hammer 18",
  "Impact New Carbon",
  "Kinetic Missile Pro",
  "Kinetic Missile Speed",
  "Lion",
  "Pro Star",
  "Storm Breaker 618",
  "Thunderbolt",
  "Turbo 716",
  "Turbo 717",
  "Kinetic Extreme Pro",
  "Kinetic Extreme Speed",
  "Viper 47 Speed",
  "Destiny Speed",
  "Destiny Control",
  "Arrow 17 Air",
  "Carbonpro 787 Deluxe",
  "Power Pro 709",
  "Power Pro 708",
  "Power Pro 707",
  "Power Pro 706",
  "Power Pro 705",
  "Power Pro 704",
  "Thunder 7004",
  "Thunder 7003",
  "Dragon",
] as const;

const slugifyFixture = (title: string) => title.toLowerCase().replace(/\s+/g, "-");

test("ProKennex falls back from blocked WordPress JSON to both rendered catalogue pages", async () => {
  const origin = "https://prokennex.test";
  const provider: ProviderConfig = {
    id: "pro-kennex-test",
    name: "ProKennex",
    origin,
    brandSlugs: ["pro-kennex"],
    platform: "woocommerce",
    catalogue: {
      kind: "woocommerce-store",
      categorySlugs: ["badminton-rackets"],
      pageSize: 100,
      htmlFallback: {
        url: `${origin}/rackets/`,
        pagePath: "page/{page}/",
        linkSelector: ".products a.woocommerce-loop-product__link",
        maxPages: 2,
      },
    },
  };
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  const card = (title: string) =>
    `<a class="woocommerce-loop-product__link" href="${origin}/product/${slugifyFixture(title)}/">${title}</a>`;

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === `${origin}/robots.txt`) {
      return new Response("User-agent: *\nDisallow:\n", { status: 200 });
    }
    if (url.includes("/wp-json/wc/store/v1/products/categories")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (url === `${origin}/rackets/`) {
      return new Response(`<div class="products">${card("Power Pro 704")}</div>`, {
        status: 200,
      });
    }
    if (url === `${origin}/rackets/page/2/`) {
      return new Response(
        `<div class="products">${card("Dragon")}${card("Power Pro 705")}</div>`,
        { status: 200 },
      );
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const result = await discoverCandidates(provider, {
      userAgent: "ShuttlecraftImageBot/1.0",
      timeoutMs: 1_000,
      delayMs: 0,
      refresh: true,
      verbose: false,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.candidates.length, 3);
    assert.deepEqual(
      result.candidates.map(({ slug, title }) => ({ slug, title })),
      [
        { slug: "power-pro-704", title: "Power Pro 704" },
        { slug: "dragon", title: "Dragon" },
        { slug: "power-pro-705", title: "Power Pro 705" },
      ],
    );
    assert.ok(requested.includes(`${origin}/rackets/`));
    assert.ok(requested.includes(`${origin}/rackets/page/2/`));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(resolve("scripts/scraper/output/sitemaps/pro-kennex-test.json"), { force: true });
  }
});

test("WooCommerce HTML fallback keeps original gallery images and excludes page furniture", () => {
  const html = `
    <div class="woocommerce-product-gallery">
      <div class="woocommerce-product-gallery__image">
        <a href="https://img.test/power-pro-704-original.jpg">
          <img src="https://img.test/power-pro-704-300x300.jpg"
               data-large_image="https://img.test/power-pro-704-original.jpg" />
        </a>
      </div>
      <div class="woocommerce-product-gallery__image">
        <a href="https://img.test/power-pro-704-back.jpg">
          <img src="data:image/svg+xml,placeholder"
               data-src="https://img.test/power-pro-704-back.jpg" />
        </a>
      </div>
    </div>
    <section class="technologies"><img src="https://img.test/carbon-tech.png" /></section>
    <section class="related"><img src="https://img.test/another-racket.jpg" /></section>
  `;

  assert.deepEqual(
    woocommerceHtmlGallery(html, "https://www.prokennex-badminton.com/product/power-pro-704/")
      .map((image) => image.url),
    [
      "https://img.test/power-pro-704-original.jpg",
      "https://img.test/power-pro-704-back.jpg",
    ],
  );
});

test("live ProKennex names map only to the correct catalogue slug and storage folder", () => {
  const provider = providerById("pro-kennex");
  assert.ok(provider);
  const source = provider.catalogue;
  if (Array.isArray(source) || source.kind !== "woocommerce-store") {
    assert.fail("ProKennex must use WooCommerce discovery");
  }
  assert.equal(
    source.htmlFallback?.url,
    "https://www.prokennex-badminton.com/product_cat/badminton/badminton-rackets/",
  );
  assert.equal(source.htmlFallback?.pagePath, "page/{page}/");

  const candidates: MatchCandidate[] = PRODUCT_TITLES.map((title) => ({
    title,
    slug: slugifyFixture(title),
    url: `https://www.prokennex-badminton.com/product/${slugifyFixture(title)}/`,
  }));
  const catalogue = [
    ["pro-kennex-dragon", "Dragon"],
    ["pro-kennex-storm-breaker-618", "Storm Breaker 618"],
    ["pro-kennex-power-pro-705", "Power Pro 705"],
    ["pro-kennex-power-pro-704", "Power Pro 704"],
    ["pro-kennex-lion", "Lion"],
    ["pro-kennex-destiny-control", "Destiny Control"],
    ["pro-kennex-destiny-speed", "Destiny Speed"],
    ["pro-kennex-power-pro-709", "Power Pro 709"],
    ["pro-kennex-power-pro-708-2022", "Power Pro 708 2022"],
    ["pro-kennex-thunder", "Thunder"],
    ["pro-kennex-carbonpro-787-deluxe", "Carbonpro 787 Deluxe"],
    ["pro-kennex-power-pro-707", "Power Pro 707"],
    ["pro-kennex-power-pro-706", "Power Pro 706"],
    ["pro-kennex-turbo-716", "Turbo 716"],
    ["pro-kennex-turbo-717", "Turbo 717"],
    ["pro-kennex-laser-7z-power", "Laser 7Z Power"],
    ["pro-kennex-thunder-7001", "Thunder 7001"],
    ["pro-kennex-kinetic-extreme-pro-xam-kim-loai", "Kinetic Extreme Pro - Xám kim loại"],
    ["pro-kennex-x3-9000-pro", "X3 9000 Pro"],
    ["pro-kennex-x3-9000-speed", "X3 9000 Speed"],
    ["pro-kennex-impact-new-carbon", "Impact New Carbon"],
    ["pro-kennex-787-deluxe", "787 Deluxe"],
    ["pro-kennex-power-pro-708", "Power Pro 708"],
  ] as const;
  const expected = new Map<string, string>([
    ["pro-kennex-dragon", "dragon"],
    ["pro-kennex-storm-breaker-618", "storm-breaker-618"],
    ["pro-kennex-power-pro-705", "power-pro-705"],
    ["pro-kennex-power-pro-704", "power-pro-704"],
    ["pro-kennex-lion", "lion"],
    ["pro-kennex-destiny-control", "destiny-control"],
    ["pro-kennex-destiny-speed", "destiny-speed"],
    ["pro-kennex-power-pro-709", "power-pro-709"],
    ["pro-kennex-carbonpro-787-deluxe", "carbonpro-787-deluxe"],
    ["pro-kennex-power-pro-707", "power-pro-707"],
    ["pro-kennex-power-pro-706", "power-pro-706"],
    ["pro-kennex-turbo-716", "turbo-716"],
    ["pro-kennex-turbo-717", "turbo-717"],
    ["pro-kennex-kinetic-extreme-pro-xam-kim-loai", "kinetic-extreme-pro"],
    ["pro-kennex-impact-new-carbon", "impact-new-carbon"],
    ["pro-kennex-power-pro-708", "power-pro-708"],
  ]);
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  const store = new SupabaseImageStore({
    client: {} as never,
    bucket: "racket-images",
    strategy: "shared",
    dryRun: true,
  });

  for (const [racketSlug, racketName] of catalogue) {
    let match = bestMatch(racketName, "Pro Kennex", candidates);
    if (!match) {
      for (const alias of provider.modelAliases?.(racketName) ?? []) {
        match = bestMatch(alias, "Pro Kennex", candidates);
        if (match) break;
      }
    }

    if (!match) {
      unmatched.push(racketSlug);
      continue;
    }

    matched.set(racketSlug, match.candidate.slug);
    const path = store.pathFor({
      provider: provider.id,
      brandSlug: "pro-kennex",
      racketSlug,
      position: 0,
      checksum: "1234567890abcdef",
      extension: "jpg",
    });
    assert.equal(
      path,
      `pro-kennex/${racketSlug.replace(/^pro-kennex-/, "")}/00-12345678.jpg`,
    );
  }

  assert.deepEqual(matched, expected);
  assert.deepEqual(unmatched.sort(), [
    "pro-kennex-787-deluxe",
    "pro-kennex-laser-7z-power",
    "pro-kennex-power-pro-708-2022",
    "pro-kennex-thunder",
    "pro-kennex-thunder-7001",
    "pro-kennex-x3-9000-pro",
    "pro-kennex-x3-9000-speed",
  ]);
});
