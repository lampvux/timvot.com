import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWooCatalogueHtml,
  scrapeWooCommerce,
  WOO_SITES,
} from "./woocommerce";

const HV_LISTING_HTML = `
  <div class="product-small col product post-123 instock product_cat-vot-cau-long product_cat-vot-cau-long-victor">
    <div class="box-image">
      <img data-lazy-src="https://hvshop.vn/images/ryuga.webp" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP" />
    </div>
    <h3 class="woocommerce-loop-product__title">
      <a class="woocommerce-loop-product__link" href="https://hvshop.vn/vot-cau-long-victor-ryuga/">
        Vợt cầu lông Victor Ryuga
      </a>
    </h3>
    <span class="price">
      <del><span class="woocommerce-Price-amount">4.200.000₫</span></del>
      <ins><span class="woocommerce-Price-amount">3.800.000₫</span></ins>
    </span>
    <a data-prod_id="123"></a>
  </div>
  <div class="product-small col product post-456 outofstock product_cat-vot-cau-long">
    <h3 class="woocommerce-loop-product__title">
      <a class="woocommerce-loop-product__link" href="https://hvshop.vn/vot-cau-long-lining-contact/">
        Vợt cầu lông Lining Contact
      </a>
    </h3>
    <span class="price">Liên hệ</span>
  </div>
`;

test("parseWooCatalogueHtml keeps the data needed by the HV Shop HTML fallback", () => {
  const cards = parseWooCatalogueHtml(HV_LISTING_HTML);

  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0], {
    title: "Vợt cầu lông Victor Ryuga",
    price: 3_800_000,
    msrp: 4_200_000,
    url: "https://hvshop.vn/vot-cau-long-victor-ryuga/",
    externalId: "123",
    imageUrl: "https://hvshop.vn/images/ryuga.webp",
    inStock: true,
    categorySlugs: ["vot-cau-long", "vot-cau-long-victor"],
  });
  assert.equal(cards[1].externalId, "456");
  assert.equal(cards[1].price, 0);
  assert.equal(cards[1].inStock, false);
});

test("HV Shop falls back to rendered catalogue HTML when its Store API returns 403", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/wp-json/wc/store/v1/products")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (url === WOO_SITES.hvshop.categoryUrl) {
      return new Response(HV_LISTING_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const result = await scrapeWooCommerce(WOO_SITES.hvshop, {
      maxPages: 1,
      concurrency: 1,
      delayMs: 0,
    });

    assert.equal(result.success, true);
    assert.equal(result.itemsCount, 1);
    assert.equal(result.pagesFetched, 1);
    assert.equal(result.products[0].externalId, "123");
    assert.equal(result.products[0].sourcePage, 1);
    assert.match(result.notes?.[0] ?? "", /HTTP 403.*rendered catalogue fallback/);
    assert.match(result.notes?.[1] ?? "", /1 listings publish no price/);
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the HTML fallback remains scoped to HV Shop", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];

  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return new Response("Forbidden", { status: 403 });
  };

  try {
    const result = await scrapeWooCommerce(WOO_SITES.fbshop, { maxPages: 1 });

    assert.equal(result.success, false);
    assert.equal(result.error, "Store API returned HTTP 403 on page 1");
    assert.equal(requested.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
