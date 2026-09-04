import assert from "node:assert/strict";
import test from "node:test";

import { wooCommerceGallery } from "./gallery";

test("WooCommerce gallery reads originals without related products or swatches", () => {
  const html = `
    <div class="woo-variation-gallery-wrapper">
      <div class="wvg-gallery-image">
        <img src="/uploads/racket-600x600.jpg"
             data-large_image="/uploads/racket.jpg"
             title="Racket front" />
      </div>
      <div class="wvg-gallery-image">
        <img src="/uploads/racket-side-600x600.jpg"
             data-src="/uploads/racket-side.jpg" />
      </div>
      <div class="wvg-gallery-image">
        <img data-large_image="/uploads/racket.jpg" />
      </div>
    </div>
    <div class="variation-swatches"><img src="/uploads/red-swatch.jpg" /></div>
    <section class="related products"><img src="/uploads/other-racket.jpg" /></section>
    <script type="text/html">
      <div class="wvg-gallery-image"><img data-large_image="{{data.full_src}}" /></div>
    </script>
  `;

  assert.deepEqual(wooCommerceGallery(html, "https://apacssports.com/product/example/"), [
    {
      url: "https://apacssports.com/uploads/racket.jpg",
      position: 0,
      caption: "Racket front",
    },
    {
      url: "https://apacssports.com/uploads/racket-side.jpg",
      position: 1,
      caption: undefined,
    },
  ]);
});
