/**
 * What counts as a racket.
 *
 * Every source files rackets alongside things that are not rackets, and the two
 * scrapers used to carry their own drifting copies of this list. It lives here
 * once so that "is this a racket" has one answer regardless of which site the
 * listing came from.
 */

/** Category slugs that mean the listing is an accessory, not a racket. */
const NON_RACKET_CATEGORY_PATTERNS = [
  /^bao-vot/,
  /^tui-vot/,
  /^cuoc-/,
  /^day-cuoc/,
  /^quan-can/,
  /^quan-vot/,
  /^giay-/,
  /^ao-/,
  /^phu-kien/,
  /^ong-cau/,
  /^qua-cau/,
  /^dich-vu/,
  /^balo/,
  /^combo/,
];

/** Titles that are plainly not a single racket, whatever the categories say. */
const NON_RACKET_TITLE_PATTERNS = [
  /^bao\s+(?:vợt|đựng)/i,
  /^túi\s+/i,
  /^cước\s+/i,
  /^dây\s+cước/i,
  /^quấn\s+cán/i,
  /^giày\s+/i,
  /^áo\s+/i,
  /^quần\s+/i,
  /^balo\s+/i,
  /^ống\s+cầu/i,
  /^quả\s+cầu/i,
  /^dịch\s+vụ/i,
  /^tất\s+/i,
  /căng\s+vợt/i,

  // Bundles. "Combo mua vợt X tặng vợt Y + giày Z" is several products at one
  // price; recording it as a racket model would put a bundle price on a spec
  // page and make the cheapest-offer comparison wrong.
  /^combo\b/i,
  /^bộ\s+(?:sản phẩm|combo)/i,
  /^set\s+/i,
  /\btặng\b.*\bvợt\b/i,
  // "Cặp vợt cầu lông ..." is a two-racket pair sold at one price — a bundle
  // wearing a model name, and priced like one.
  /^cặp\s+vợt/i,
  /^cap\s+vot/i,

  // Pickleball and tennis frames share the "vợt" noun but not the catalogue.
  /pickleball/i,
  /\bvợt\s+tennis\b/i,
  /\bcầu\s+lông\s+trẻ\s+em\s+nhựa\b/i,
];

export function isRacketListing(title: string, categorySlugs: string[] = []): boolean {
  if (categorySlugs.some((slug) => NON_RACKET_CATEGORY_PATTERNS.some((re) => re.test(slug)))) {
    return false;
  }
  return !NON_RACKET_TITLE_PATTERNS.some((re) => re.test(title));
}
