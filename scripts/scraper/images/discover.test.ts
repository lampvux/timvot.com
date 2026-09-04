import assert from "node:assert/strict";
import test from "node:test";

import { parseWooCategoryTreePage } from "./discover";

const ROOT =
  "https://apacssports.com/product-category/badminton/badminton-rackets/";

test("WooCommerce category tree follows category cards below the configured root", () => {
  const html = `
    <aside>
      <a href="/product-category/badminton/badminton-footwear/">Footwear</a>
      <a href="${ROOT}badminton-entry/">Sidebar duplicate</a>
    </aside>
    <ul class="products-list">
      <li class="product-category product">
        <a href="${ROOT}badminton-entry/">
          <h2 class="woocommerce-loop-category__title">Entry <mark>(17)</mark></h2>
        </a>
      </li>
      <li class="product-category product">
        <a href="${ROOT}badminton-intermediate/">
          <h2 class="woocommerce-loop-category__title">Intermediate</h2>
        </a>
      </li>
    </ul>
  `;

  const parsed = parseWooCategoryTreePage(html, ROOT, ROOT);

  assert.deepEqual(parsed.categoryUrls, [
    `${ROOT}badminton-entry/`,
    `${ROOT}badminton-intermediate/`,
  ]);
  assert.deepEqual(parsed.paginationUrls, []);
  assert.deepEqual(parsed.products, []);
});

test("WooCommerce category tree reads product cards and listing pagination", () => {
  const page = `${ROOT}badminton-entry/entry-tyro/`;
  const html = `
    <ul class="products-list">
      <li class="product type-product post-1">
        <a href="https://apacssports.com/product/tyro-55/">Read more</a>
        <div class="product-item-info">
          <h4><a href="/product/tyro-55/"> Tyro&nbsp;55 </a></h4>
        </div>
      </li>
      <li class="product type-product post-2">
        <div class="product-item-info">
          <h4><a href="/product/tyro-junior-116/">Tyro Junior 116</a></h4>
        </div>
      </li>
    </ul>
    <nav class="woocommerce-pagination">
      <a class="next page-numbers" href="${page}page/2/">Next</a>
    </nav>
    <section class="related products">
      <a href="/product/not-a-listing-card/">Related racket</a>
    </section>
  `;

  const parsed = parseWooCategoryTreePage(html, page, ROOT);

  assert.deepEqual(parsed.categoryUrls, []);
  assert.deepEqual(parsed.paginationUrls, [`${page}page/2/`]);
  assert.deepEqual(parsed.products, [
    { url: "https://apacssports.com/product/tyro-55/", title: "Tyro 55" },
    {
      url: "https://apacssports.com/product/tyro-junior-116/",
      title: "Tyro Junior 116",
    },
  ]);
});

test("WooCommerce category tree rejects products and pagination outside the site", () => {
  const html = `
    <ul>
      <li class="product type-product"><h4><a href="https://example.com/product/fake/">Fake</a></h4></li>
    </ul>
    <nav class="woocommerce-pagination">
      <a href="https://example.com/product-category/badminton/badminton-rackets/page/2/">2</a>
    </nav>
  `;

  const parsed = parseWooCategoryTreePage(html, ROOT, ROOT);
  assert.deepEqual(parsed, { categoryUrls: [], paginationUrls: [], products: [] });
});
