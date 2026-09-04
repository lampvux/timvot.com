/**
 * Pulling a product gallery out of a manufacturer's product page.
 *
 * Every extractor here reads *structured* data the page already carries for its
 * own front end — Magento's gallery init block, Victor's `__NEXT_DATA__`,
 * Shopify's product JSON, schema.org markup, or a platform-owned gallery
 * container. None of them harvest arbitrary `<img>` tags, and that is the whole
 * point: a product page is 60–80 images, of which six are the product and the
 * rest are the nav logo, four technology diagrams, ten "you may also like"
 * thumbnails and a payment-provider strip. Harvesting every `<img>` would fill
 * the bucket with other rackets' photographs filed under this racket's id,
 * which is worse than having no gallery at all.
 *
 * The last resort, `structuredData`, is still structured: schema.org `Product`
 * or OpenGraph, both of which name the product's own images explicitly.
 */

import * as cheerio from "cheerio";
import { decodeEntities } from "../http";

export interface GalleryImage {
  /** Full-resolution URL, after any known upscale trick for the platform. */
  url: string;
  position: number;
  /** Colour the manufacturer files this shot under, when the gallery is split. */
  colourway?: string;
  caption?: string;
}

export type GalleryExtractor = (html: string, pageUrl: string) => GalleryImage[];

/* ------------------------------------------------------------------ helpers */

function absolute(url: string, pageUrl: string): string {
  if (!url) return "";
  try {
    return new URL(url.replace(/\\\//g, "/"), pageUrl).toString();
  } catch {
    return "";
  }
}

/**
 * Collapse a list to first-seen order, keyed on the URL with its query string
 * removed. Magento serves the same file at a dozen sizes and Shopify appends a
 * `?v=` cache buster, so keying on the whole URL keeps duplicates.
 */
function dedupe(images: GalleryImage[]): GalleryImage[] {
  const seen = new Set<string>();
  const out: GalleryImage[] = [];

  for (const image of images) {
    if (!image.url) continue;
    let key = image.url;
    try {
      const parsed = new URL(image.url);
      key = `${parsed.origin}${parsed.pathname}`;
    } catch {
      /* keep the raw string as the key */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...image, position: out.length });
  }

  return out;
}

/** Reject the sprites, icons and 1×1 pixels that share a CDN with the gallery. */
const NON_PRODUCT = /(?:sprite|placeholder|loading|spinner|logo|icon|favicon|blank|pixel|swatch-thumb)/i;

function isPlausible(url: string): boolean {
  if (!url || !/^https?:/i.test(url)) return false;
  if (url.startsWith("data:")) return false;
  if (NON_PRODUCT.test(url)) return false;
  return /\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(url) || /\/media\/|\/images?\//i.test(url);
}

/* ------------------------------------------------------------------ Magento */

/**
 * Magento 2 (yonex.com).
 *
 * The gallery is initialised from a `<script type="text/x-magento-init">` block
 * whose payload holds `"mage/gallery/gallery": { "data": [ … ] }`, one entry per
 * shot with `thumb` / `img` / `full` sizes. On a configurable product the colour
 * swatches carry their own galleries under the swatch renderer's
 * `jsonConfig.images`, keyed by child product id — that is where the second and
 * third colourways of a frame live, and reading only the main block misses them.
 *
 * The `full` URL is Magento's resize endpoint with empty dimensions
 * (`height=&width=&canvas=:`), which returns the original upload. We keep that
 * rather than the 600px `img`, because the point of this crawl is to stop
 * depending on someone else's thumbnail.
 */
export const magentoGallery: GalleryExtractor = (html, pageUrl) => {
  const images: GalleryImage[] = [];

  interface MagentoEntry {
    thumb?: string;
    img?: string;
    full?: string;
    caption?: string | null;
    position?: string | number;
    type?: string;
    videoUrl?: string | null;
  }

  const push = (entry: MagentoEntry, colourway?: string) => {
    if (entry.type && entry.type !== "image") return;
    if (entry.videoUrl) return;
    const url = absolute(entry.full || entry.img || entry.thumb || "", pageUrl);
    if (!isPlausible(url)) return;
    images.push({
      url,
      position: Number(entry.position ?? images.length) || images.length,
      caption: entry.caption ? decodeEntities(entry.caption) : undefined,
      colourway,
    });
  };

  // The init blocks are HTML-escaped JSON inside a script tag. Slice each one
  // out by brace balance rather than by regex: the payload contains both quoted
  // braces and escaped quotes, and no regex survives both.
  for (const match of html.matchAll(/"mage\/gallery\/gallery"\s*:\s*\{/g)) {
    const block = balancedSlice(html, match.index! + match[0].length - 1);
    if (!block) continue;
    const data = readJsonArray(block, '"data"');
    for (const entry of data as MagentoEntry[]) push(entry);
  }

  // Per-colour galleries from the swatch renderer.
  for (const match of html.matchAll(/"jsonConfig"\s*:\s*\{/g)) {
    const block = balancedSlice(html, match.index! + match[0].length - 1);
    if (!block) continue;

    let config: {
      images?: Record<string, MagentoEntry[]>;
      attributes?: Record<string, { code?: string; options?: { label?: string; products?: string[] }[] }>;
    };
    try {
      config = JSON.parse(unescapeHtmlJson(block));
    } catch {
      continue;
    }
    if (!config.images) continue;

    // Map child product id → colour label, so each gallery is attributed.
    const colourOf = new Map<string, string>();
    for (const attribute of Object.values(config.attributes ?? {})) {
      if (attribute.code !== "color") continue;
      for (const option of attribute.options ?? []) {
        for (const productId of option.products ?? []) {
          if (option.label) colourOf.set(productId, option.label);
        }
      }
    }

    for (const [productId, entries] of Object.entries(config.images)) {
      for (const entry of entries) push(entry, colourOf.get(productId));
    }
  }

  return dedupe(images);
};

/* ------------------------------------------------------- Victor (Next.js) */

/**
 * victorsport.com renders through Next.js and ships the product in
 * `__NEXT_DATA__`. The gallery is `props.pageProps.product.product.imgs[]`, each
 * with a `sequence`; the colourways are `productVariantList.variants[]`, each
 * with its own `imageUrl` and `attributeValues`.
 *
 * The distinction that matters here is `recommendProducts`, a sibling key
 * holding ten *other* rackets' photographs. Reading the tree by path rather
 * than searching it for image-shaped strings is what keeps those out.
 */
export const nextDataGallery: GalleryExtractor = (html, pageUrl) => {
  const match = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const pageProps = (payload as { props?: { pageProps?: Record<string, unknown> } })?.props?.pageProps;
  const wrapper = pageProps?.product as
    | {
        product?: { imgs?: { url?: string; sequence?: number; description?: string }[] };
        productVariantList?: { variants?: { imageUrl?: string; attributeValues?: string[] }[] };
      }
    | undefined;
  if (!wrapper) return [];

  const images: GalleryImage[] = [];
  const variants = wrapper.productVariantList?.variants ?? [];

  // Victor publishes one page per colourway, so a page with a single variant is
  // a page about one colour and its whole gallery is that colour's photography.
  // Reading the colour off the variant and applying it to the gallery is what
  // makes `racket_images.colourway` mean something; without it every row on a
  // seven-colour frame comes back null and the merged gallery is an unlabelled
  // pile. A page with several variants is a colour picker over shared shots, so
  // nothing is attributed.
  const soleColour = variants.length === 1 ? variants[0].attributeValues?.[0] : undefined;

  for (const img of wrapper.product?.imgs ?? []) {
    const url = absolute(img.url ?? "", pageUrl);
    if (isPlausible(url)) {
      images.push({
        url,
        position: img.sequence ?? images.length,
        caption: img.description,
        colourway: soleColour,
      });
    }
  }

  for (const variant of variants) {
    const url = absolute(variant.imageUrl ?? "", pageUrl);
    if (isPlausible(url)) {
      images.push({ url, position: images.length, colourway: variant.attributeValues?.[0] });
    }
  }

  return dedupe(images.sort((a, b) => a.position - b.position));
};

/* ------------------------------------------------------------------ Shopify */

/**
 * Shopify exposes every product as JSON at `<product-url>.js`, so the extractor
 * for a Shopify storefront does not parse HTML at all — see `fetchShopifyJson`.
 * This variant covers the case where only the rendered page is in hand, by
 * reading the product JSON the theme inlines for its own variant picker.
 */
export const shopifyGallery: GalleryExtractor = (html, pageUrl) => {
  const images: GalleryImage[] = [];

  for (const match of html.matchAll(
    /<script[^>]+type="application\/json"[^>]*id="ProductJson[^"]*"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const product = JSON.parse(match[1]) as { images?: string[]; media?: { src?: string }[] };
      for (const src of product.images ?? []) {
        const url = absolute(src, pageUrl);
        if (isPlausible(url)) images.push({ url, position: images.length });
      }
      for (const media of product.media ?? []) {
        const url = absolute(media.src ?? "", pageUrl);
        if (isPlausible(url)) images.push({ url, position: images.length });
      }
    } catch {
      continue;
    }
  }

  return dedupe(images.map((image) => ({ ...image, url: shopifyOriginal(image.url) })));
};

/** Strip Shopify's `_600x600` size infix to get the uploaded original. */
export function shopifyOriginal(url: string): string {
  return url.replace(/_(?:\d+x\d*|\d*x\d+|master|grande|large|medium|small|pico|icon|thumb)(?=\.[a-z]+(?:$|\?))/i, "");
}

/** Parse the payload of `<product>.js`, Shopify's public product endpoint. */
export function parseShopifyProductJson(body: string, pageUrl: string): GalleryImage[] {
  let product: { images?: string[]; media?: { src?: string; media_type?: string }[] };
  try {
    product = JSON.parse(body);
  } catch {
    return [];
  }

  const images: GalleryImage[] = [];
  for (const media of product.media ?? []) {
    if (media.media_type && media.media_type !== "image") continue;
    const url = absolute(media.src ?? "", pageUrl);
    if (isPlausible(url)) images.push({ url: shopifyOriginal(url), position: images.length });
  }
  for (const src of product.images ?? []) {
    const url = absolute(src, pageUrl);
    if (isPlausible(url)) images.push({ url: shopifyOriginal(url), position: images.length });
  }

  return dedupe(images);
}

/* ------------------------------------------------------------ WooCommerce */

/** Parse one product from the WooCommerce Store API (`/wp-json/wc/store/v1`). */
export function parseWooProductJson(body: string, pageUrl: string): GalleryImage[] {
  let items: { images?: { src?: string; name?: string }[] }[];
  try {
    const parsed = JSON.parse(body);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  const images: GalleryImage[] = [];
  for (const item of items) {
    for (const image of item.images ?? []) {
      const url = absolute(image.src ?? "", pageUrl);
      if (isPlausible(url)) images.push({ url, position: images.length, caption: image.name });
    }
  }

  return dedupe(images);
}

/**
 * Read the standard WooCommerce product gallery from rendered HTML.
 *
 * This path matters on CI networks where a WordPress firewall rejects
 * `/wp-json/` while continuing to serve the public category and product pages.
 * It is deliberately scoped to WooCommerce's gallery wrapper, so technology
 * icons, related products and footer logos can never become racket photos.
 */
export const woocommerceHtmlGallery: GalleryExtractor = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const images: GalleryImage[] = [];

  $(".woocommerce-product-gallery__image").each((_, el) => {
    const $slide = $(el);
    const $image = $slide.find("img").first();
    const candidates = [
      $image.attr("data-large_image"),
      $slide.find("a[href]").first().attr("href"),
      $image.attr("data-src"),
      $image.attr("src"),
    ];

    for (const candidate of candidates) {
      const url = absolute(candidate ?? "", pageUrl);
      if (!isPlausible(url)) continue;
      images.push({
        url,
        position: images.length,
        caption: $image.attr("data-caption") || $image.attr("alt") || undefined,
      });
      break;
    }
    });
      return dedupe(images);
};
/**
 * Read the full-resolution files declared by a WooCommerce product gallery.
 *
 * APACS' schema.org Product block names only the hero, while the gallery's own
 * `data-large_image` attributes name every original upload. The selector is
 * deliberately limited to WooCommerce's product-gallery wrappers: related
 * products, colour swatches, specification art and the page chrome also contain
 * `<img>` tags, but none of them belong to this collection.
 */
export const wooCommerceGallery: GalleryExtractor = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const images: GalleryImage[] = [];

  $(
    ".woocommerce-product-gallery__image img, " +
      ".woocommerce-product-gallery .wvg-gallery-image img, " +
      ".woo-variation-gallery-wrapper .wvg-gallery-image img",
  ).each((_, element) => {
    const image = $(element);
    const raw =
      image.attr("data-large_image") ?? image.attr("data-src") ?? image.attr("src") ?? "";
    // The theme ships an Underscore template containing `{{data.full_src}}` on
    // every page. Cheerio normally leaves script contents inert, but refusing
    // template tokens here makes that boundary explicit.
    if (!raw || /\{[{#]/.test(raw)) return;

    const url = absolute(raw, pageUrl);
    if (!isPlausible(url)) return;

    const caption =
      image.attr("data-caption") || image.attr("title") || image.attr("alt") || undefined;
    images.push({
      url,
      position: images.length,
      caption: caption ? decodeEntities(caption) : undefined,
    });
  });

  return dedupe(images);
};

/* ------------------------------------------------------- schema.org / OG */

/**
 * The generic fallback: schema.org `Product.image` first, OpenGraph second.
 *
 * Both are declarations by the site about which images *are* the product, which
 * is the only signal on an unknown template worth trusting. A site that
 * publishes neither gets no gallery, and the run says so — that is a truthful
 * "we could not read this one", and it is the right outcome.
 */
export const structuredDataGallery: GalleryExtractor = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const images: GalleryImage[] = [];

  const collect = (value: unknown) => {
    if (typeof value === "string") {
      const url = absolute(value, pageUrl);
      if (isPlausible(url)) images.push({ url, position: images.length });
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }
    if (value && typeof value === "object") {
      const node = value as { url?: string; contentUrl?: string };
      collect(node.contentUrl ?? node.url);
    }
  };

  const visitNode = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const entry of node) visitNode(entry);
      return;
    }
    if (!node || typeof node !== "object") return;

    const typed = node as Record<string, unknown>;
    const graph = typed["@graph"];
    if (graph) visitNode(graph);

    const type = typed["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("Product") || types.includes("ProductModel")) collect(typed.image);
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      visitNode(JSON.parse(raw));
    } catch {
      /* a malformed block is not a reason to abandon the others */
    }
  });

  if (images.length === 0) {
    $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').each(
      (_, el) => {
        const url = absolute($(el).attr("content") ?? "", pageUrl);
        if (isPlausible(url)) images.push({ url, position: images.length });
      },
    );
  }

  return dedupe(images);
};

/* ------------------------------------------------------------ JSON slicing */

/**
 * Take the balanced `{…}` run starting at `start`, respecting strings and
 * escapes. Magento's init payload is JSON embedded in HTML embedded in a script
 * tag; a regex either stops at the first `}` inside a caption or runs to the end
 * of the document, and both have bitten this file's predecessors.
 */
function balancedSlice(text: string, start: number): string | null {
  if (text[start] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/** HTML-escaped JSON inside a script tag comes back with entities intact. */
function unescapeHtmlJson(block: string): string {
  return decodeEntities(block);
}

/** Read one array-valued key out of a JSON block without parsing the whole thing. */
function readJsonArray(block: string, key: string): unknown[] {
  const at = block.indexOf(key);
  if (at < 0) return [];

  const open = block.indexOf("[", at);
  if (open < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < block.length; i++) {
    const char = block[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(unescapeHtmlJson(block.slice(open, i + 1)));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }

  return [];
}

/* ------------------------------------------------- WordPress media library */

/**
 * A WordPress site whose product photographs are identifiable by filename.
 *
 * This is the extractor of last resort, for a site that publishes no
 * structured data at all. fz-forza.com is one: a marketing site rather than a
 * shop, with no schema.org block, no product API and an og:image whose url is
 * malformed. Its product photographs are still perfectly identifiable, because
 * WordPress keeps the filename the manufacturer uploaded and FZ Forza names
 * every shot after the item number it prints on the page — FZ262671_1001_
 * K-POWER36-M_100. Nothing else under /wp-content/uploads/ on those pages is a
 * photograph of the racket: the rest is the site logo and the technology
 * badges that explain what Kevlar is.
 *
 * So the pattern is the provider's to supply, and it is matched against the
 * filename rather than the whole url, which keeps a date folder like
 * /2025/11/ from ever matching by accident.
 *
 * Jetpack serves those uploads through its photon host with a resize query
 * (i0.wp.com/<site>/wp-content/…?resize=1080%2C1560). The origin url behind
 * that prefix is the untouched upload, so it is unwrapped rather than
 * downloaded at whatever width the page happened to render.
 */
export function wpUploadsGallery(namePattern: RegExp): GalleryExtractor {
  return (html, pageUrl) => {
    const images: GalleryImage[] = [];

    for (const match of html.matchAll(/["'(](https?:[^"')\s]*\/wp-content\/uploads\/[^"')\s]+)/gi)) {
      const unwrapped = match[1].replace(/^https?:\/\/i\d\.wp\.com\/([^/]+)/i, "https://$1");
      const url = absolute(unwrapped.split("?")[0], pageUrl);
      const filename = url.split("/").pop() ?? "";
      if (!namePattern.test(filename)) continue;
      if (!isPlausible(url)) continue;
      images.push({ url, position: images.length });
    }

    return dedupe(images);
  };
}

/* ----------------------------------------------------------------- META.vn */

/**
 * meta.vn, whose product images are a filename convention and a resize proxy.
 *
 * The page's schema.org block carries exactly one image — the hero — while the
 * gallery beside it holds two or three more, so reading the structured data
 * here costs two thirds of the photography. What the shop does instead is name
 * every shot after the product: `<slug>-g.jpg` is the hero and `<slug>-1.jpg`,
 * `-2.jpg` are the rest, all under a dated `/Data/image/YYYY/MM/DD/` folder.
 *
 * Two things are deliberately dropped. Anything under `/thumb/` is the resize
 * proxy — `media.meta.vn/thumb/200x200x95/…` is the 200px card image of a file
 * already collected at full size — and `-600.jpg` is a 600×600 square crop of
 * the hero rather than a photograph of its own. What is left is the shop's
 * banners, which never live under a dated image folder, and the product.
 *
 * Enumerating `-3.jpg`, `-4.jpg` and so on is not safe here and is not done:
 * meta.vn answers a missing image with a 1×1 tracking gif and HTTP 200, not a
 * 404, so a guessed url comes back looking like a successful download.
 */
export const metaVnGallery: GalleryExtractor = (html, pageUrl) => {
  const images: GalleryImage[] = [];

  for (const match of html.matchAll(/["'](https?:[^"')\s]*\/Data\/[Ii]mage\/[^"')\s]+)/g)) {
    const raw = match[1];
    if (/\/thumb\//i.test(raw)) continue;

    // Three spellings of one file, folded into one so dedupe can see it:
    // media.meta.vn and meta.vn serve the same path, and the shop writes the
    // folder as both `/Data/image/` and `/Data/Image/` — sometimes for two
    // shots of the same product — where its own server treats the two as the
    // same file and returns the same bytes for either.
    const url = absolute(
      raw
        .split("?")[0]
        .replace(/\/\/media\.meta\.vn\//i, "//meta.vn/")
        .replace(/\/Data\/Image\//, "/Data/image/"),
      pageUrl,
    );
    if (/-600\.(?:jpe?g|png|webp)$/i.test(url)) continue;
    if (!isPlausible(url)) continue;

    images.push({ url, position: images.length });
  }

  return dedupe(images);
};
