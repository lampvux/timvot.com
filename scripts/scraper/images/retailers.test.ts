import assert from "node:assert/strict";
import test from "node:test";
import { assertCompleteRetailerPlan, backfillOptions, canResumeRetailerGallery } from "./retailer-backfill";
import { RETAILERS, discoverRetailer, interleaveRetailerImages, parseRetailerGallery, planRetailerTargets, retailerModelKey, retailerProduct, retailerUrl, type RetailerDiscovery } from "./retailers";
import type { RacketTarget } from "./targets";

const racket = (name = "Astrox 99 Pro", id = "r-99-pro"): RacketTarget => ({ id, slug: name.toLowerCase().replaceAll(" ", "-"), name, brandSlug: "yonex", brandName: "Yonex", equivalentIds: [id] });
const discovery = (site: typeof RETAILERS[number], name = "Vợt cầu lông Yonex Astrox 99 Pro"): RetailerDiscovery => ({ site, complete: true, pagesRead: 1, products: [retailerProduct(site, name, "/product/99-pro")!] });

test("missing-gallery plan includes every retailer, including explicit misses", () => {
  const [target] = planRetailerTargets([racket()], new Set(), [discovery("vnb"), discovery("fbshop"), { ...discovery("qvbadminton"), products: [] }, discovery("hvshop")], new Map());
  assert.deepEqual(target.sites.map((site) => site.site), RETAILERS);
  assert.deepEqual(target.sites.map((site) => site.pages.length), [1, 1, 0, 1]);
});

test("any existing gallery, including an equivalent row's admin photo, excludes a target", () => {
  const target = { ...racket(), equivalentIds: ["r-99-pro", "seed-99"] };
  assert.deepEqual(planRetailerTargets([target], new Set(["seed-99"]), [discovery("vnb")], new Map()), []);
});

test("a source page already owned by another racket cannot be borrowed", () => {
  const source = discovery("vnb");
  const [target] = planRetailerTargets([racket()], new Set(), [source], new Map([[source.products[0].url, "another-racket"]]));
  assert.equal(target.sites[0].pages.length, 0);
});

test("signature, limited, year and generation suffixes survive model normalization", () => {
  const standard = retailerModelKey("Astrox 99 Pro", "yonex");
  for (const suffix of ["LCW", "BP", "Limited", "2024", "II", "Tour", "Game"]) {
    assert.notEqual(retailerModelKey(`Vợt cầu lông Yonex Astrox 99 Pro ${suffix} chính hãng`, "yonex"), standard);
  }
  assert.equal(retailerModelKey("Vợt cầu lông Yonex Astrox 99 Pro 4U G5 chính hãng", "yonex"), standard);
  assert.equal(retailerModelKey("Astrox 88D Pro", "yonex"), retailerModelKey("Astrox 88 D Pro", "yonex"));
});

test("a limited-edition target never receives the base model's gallery", () => {
  const [target] = planRetailerTargets([racket("Astrox 99 Pro LCW")], new Set(), [discovery("vnb")], new Map());
  assert.equal(target.sites[0].pages.length, 0);
});

test("ambiguous model aliases cannot steal a page even when one has images", () => {
  const a = racket("Astrox 88D Pro", "a");
  const b = racket("Astrox 88 D Pro", "b");
  const [target] = planRetailerTargets([a, b], new Set(["a"]), [discovery("vnb", "Vợt cầu lông Yonex Astrox 88D Pro")], new Map());
  assert.equal(target.id, "b");
  assert.equal(target.sites[0].pages.length, 0);
});

test("source budgets are independent and ordered round-robin", () => {
  assert.deepEqual(interleaveRetailerImages([["v1", "v2", "v3"], ["f1", "f2"], [], ["h1"]], 2), ["v1", "f1", "h1", "v2", "f2"]);
});

test("VNB gallery uses the lightbox original and ignores related-product thumbnails", () => {
  const images = parseRetailerGallery('<div id="lightgallery"><a href="https://cdn.shopvnb.com/uploads/san_pham/a.webp"><img src="/tiny.jpg"></a></div><div class="related"><img src="/other.jpg"></div>', "https://shopvnb.com/a.html", "vnb");
  assert.deepEqual(images.map((image) => image.url), ["https://cdn.shopvnb.com/uploads/san_pham/a.webp"]);
});

test("FBShop custom gallery reads lazy originals once and keeps their exact URL", () => {
  const images = parseRetailerGallery('<div class="prddt-slider-main"><div class="gItem" data-src="https://static.fbshop.vn/a-watermarked.jpg"></div><div class="gItem" data-src="https://static.fbshop.vn/a-watermarked.jpg"></div></div><img src="/related.jpg">', "https://fbshop.vn/p/a/", "fbshop");
  assert.deepEqual(images.map((image) => image.url), ["https://static.fbshop.vn/a-watermarked.jpg"]);
});

test("WooCommerce extracts every original within the product gallery only", () => {
  const images = parseRetailerGallery('<div class="woocommerce-product-gallery__image"><a href="/original.jpg"><img src="/small.jpg" data-large_image="/original.jpg"></a></div><div class="related"><img src="/other.jpg"></div>', "https://hvshop.vn/racket/", "hvshop");
  assert.deepEqual(images.map((image) => image.url), ["https://hvshop.vn/original.jpg"]);
});

test("retailer URLs reject private addresses, credentials, unrelated hosts and unsafe protocols", () => {
  for (const url of ["http://hvshop.vn/a", "https://127.0.0.1/a", "https://hvshop.vn.evil.test/a", "https://hvshop.vn@evil.test/a", "https://user:password@hvshop.vn/a", "file:///C:/secret", "https://hvshop.vn:444/a"]) assert.equal(retailerUrl(url, "hvshop", true), null, url);
  assert.equal(retailerUrl("https://cdn.shopvnb.com/a.webp", "vnb", true), "https://cdn.shopvnb.com/a.webp");
  assert.equal(retailerUrl("https://cdn.shopvnb.com/a.webp", "vnb"), null);
});

test("API discovery walks all pages and retains out-of-stock/zero-price galleries", async () => {
  const seen: string[] = [];
  const result = await discoverRetailer("qvbadminton", async (url) => {
    seen.push(url);
    const page = new URL(url).searchParams.get("page");
    return { headers: new Headers({ "x-wp-totalpages": "2" }), body: JSON.stringify([{ id: Number(page), name: `Vợt cầu lông Yonex Astrox ${page} Pro`, permalink: `https://qvbadminton.com/racket-${page}/`, is_in_stock: false, prices: { price: "0" }, images: [{ src: `https://qvbadminton.com/photo-${page}.jpg` }] }]) };
  });
  assert.equal(result.complete, true);
  assert.equal(seen.length, 2);
  assert.equal(result.products.length, 2);
  assert.equal(result.products[1].images.length, 1);
});

test("a later API failure remains explicitly partial instead of claiming a full crawl", async () => {
  let calls = 0;
  const result = await discoverRetailer("qvbadminton", async () => {
    if (++calls === 2) throw new Error("HTTP 503");
    return { headers: new Headers({ "x-wp-totalpages": "2" }), body: JSON.stringify([{ id: 1, name: "Vợt cầu lông Yonex Astrox 99 Pro", permalink: "https://qvbadminton.com/99/" }]) };
  });
  assert.equal(result.complete, false);
  assert.match(result.error!, /503/);
  assert.equal(result.products.length, 1);
});

test("blocked Store API falls back to the retailer's public HTML catalogue", async () => {
  const result = await discoverRetailer("hvshop", async (url) => {
    if (url.includes("wp-json")) throw new Error("HTTP 403");
    return { headers: new Headers(), body: '<li class="product"><a class="woocommerce-loop-product__link" href="https://hvshop.vn/99/"><span class="woocommerce-loop-product__title">Vợt cầu lông Yonex Astrox 99 Pro</span></a></li>' };
  });
  assert.equal(result.complete, true);
  assert.equal(result.products.length, 1);
});

test("failed discovery appears for the source on every target", () => {
  const [target] = planRetailerTargets([racket()], new Set(), [{ site: "vnb", complete: false, error: "HTTP 503", pagesRead: 0, products: [] }], new Map());
  assert.equal(target.sites[0].error, "HTTP 503");
  assert.equal(target.sites[1].discoveryComplete, false);
});

test("FBShop walks only public product sitemaps and reads actual product titles", async () => {
  const calls: string[] = [];
  const result = await discoverRetailer("fbshop", async (url) => {
    calls.push(url);
    const body = url.endsWith("sitemap_index.xml")
      ? '<sitemapindex><sitemap><loc>https://fbshop.vn/product-sitemap.xml</loc></sitemap><sitemap><loc>https://fbshop.vn/post-sitemap.xml</loc></sitemap></sitemapindex>'
      : url.endsWith("product-sitemap.xml")
        ? '<urlset><url><loc>https://fbshop.vn/p/vot-cau-long-yonex-old-slug/</loc></url><url><loc>https://fbshop.vn/p/giay-yonex/</loc></url></urlset>'
        : '<h1>Vợt cầu lông Yonex Astrox 99 Pro LCW</h1><div class="prddt-slider-main"><div class="gItem" data-src="https://static.fbshop.vn/lcw.jpg"></div></div>';
    return { body, headers: new Headers() };
  });
  assert.equal(result.complete, true);
  assert.equal(calls.length, 3);
  assert.equal(result.products[0].modelKey, "astrox99prolcw");
  assert.equal(result.products[0].images.length, 1);
  assert.ok(calls.every((url) => !url.includes("wp-json") && !url.includes("post-sitemap")));
});

test("CLI fails closed on typos, invalid limits and unplanned writes", () => {
  for (const args of [["--refresh"], ["--apply"], ["--limit=0"], ["--limit=NaN"], ["--concurrency"], ["--apply=false"], ["--plan"], ["--apply", "--validate", "--plan=x"]]) assert.throws(() => backfillOptions(args));
  assert.equal(backfillOptions([]).apply, false);
  assert.equal(backfillOptions(["--apply", "--plan=x"]).apply, true);
});

test("sitemap discovery can defer galleries while retaining every nominated product URL", async () => {
  let requests = 0;
  const result = await discoverRetailer("fbshop", async (url) => {
    requests++;
    assert.ok(url.endsWith(".xml"), "Product pages must wait until the live gallery validation");
    return { headers: new Headers(), body: url.endsWith("sitemap_index.xml")
      ? '<sitemapindex><sitemap><loc>https://fbshop.vn/product-sitemap.xml</loc></sitemap></sitemapindex>'
      : '<urlset><url><loc>https://fbshop.vn/p/vot-cau-long-yonex-astrox-99-pro-lcw/</loc></url></urlset>' };
  }, { deferProductPages: true });
  assert.equal(requests, 2);
  assert.equal(result.complete, true);
  assert.equal(result.products[0].modelKey, "astrox99prolcw");
  assert.deepEqual(result.products[0].images, []);
});

test("resuming permits only rows written by this exact plan, never staff edits", () => {
  const row = { id: "retail-plan-1-racket-sha", provider: "retailer-vnb", admin_managed: false } as Parameters<typeof canResumeRetailerGallery>[0][number];
  assert.equal(canResumeRetailerGallery([row], "plan-1"), true);
  assert.equal(canResumeRetailerGallery([row], "plan-2"), false);
  assert.equal(canResumeRetailerGallery([{ ...row, admin_managed: true }], "plan-1"), false);
  assert.equal(canResumeRetailerGallery([{ ...row, provider: "admin" }], "plan-1"), false);
});

test("uploads require completed discovery and coverage for all four retailers", () => {
  const discoveries = RETAILERS.map((site) => discovery(site));
  const targets = planRetailerTargets([racket()], new Set(), discoveries, new Map());
  assert.doesNotThrow(() => assertCompleteRetailerPlan({ discoveries, targets }));
  assert.throws(() => assertCompleteRetailerPlan({ discoveries: discoveries.slice(1), targets }), /vnb/);
  assert.throws(() => assertCompleteRetailerPlan({ discoveries: discoveries.map((source) => source.site === "fbshop" ? { ...source, complete: false } : source), targets }), /fbshop/);
  assert.throws(() => assertCompleteRetailerPlan({ discoveries, targets: [{ ...targets[0], sites: targets[0].sites.slice(1) }] }), /vnb/);
});
