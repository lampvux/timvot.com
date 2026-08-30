import type {
  Brand,
  Guide,
  Offer,
  PricePoint,
  Racket,
  RacketImage,
  RacketVariant,
  Review,
  Seller,
} from "@/lib/types";

/**
 * Postgres rows in, domain objects out. The database speaks snake_case and
 * splits localised text into `_en` / `_vi` columns; the app speaks camelCase
 * and carries both locales together. This file is the only place that knows.
 */

/**
 * The racket read, in two shapes.
 *
 * `RACKET_SELECT` is the one to use. `RACKET_SELECT_NO_THUMBS` exists for a
 * single narrow case: a deployment that is ahead of its database.
 *
 * PostgREST rejects the whole query when it names a column the schema does not
 * have, and `loadSnapshot` answers any query error by falling back to the
 * seeded catalogue. So shipping the thumbnail columns before
 * `20260828000000_image_thumbnails.sql` is applied does not show the catalogue
 * without thumbnails — it shows eighteen seeded rackets instead of three
 * thousand, with no error anywhere. That is the same class of silent
 * truncation as the 1000-row cap, and it is worth one retry to avoid.
 *
 * Delete this pair once the migration is applied everywhere it needs to be.
 */
const RACKET_COLUMNS = `
  id, slug, name, release_year, balance_point_mm, shaft_flex,
  shaft_diameter_mm, frame_shape, frame_material, max_tension_min_lbs,
  max_tension_max_lbs, length_mm, string_pattern, msrp, currency,
  play_style_tags, skill_level, hero_image_url, summary_en, summary_vi,
  brand:brands!inner ( slug, name ),
  variants:racket_variants ( id, racket_id, weight_class, weight_grams, grip_size, colourway, sku )`;

const IMAGE_COLUMNS =
  "id, racket_id, provider, source_url, source_page_url, storage_bucket, " +
  "storage_path, public_url, position, is_hero, content_type, bytes, width, " +
  "height, checksum, colourway";

export const RACKET_SELECT = `${RACKET_COLUMNS.replace(
  "hero_image_url,",
  "hero_image_url, hero_thumb_url,",
)},
  images:racket_images ( ${IMAGE_COLUMNS}, thumb_url )
`;

export const RACKET_SELECT_NO_THUMBS = `${RACKET_COLUMNS},
  images:racket_images ( ${IMAGE_COLUMNS} )
`;

/**
 * Catalogue cards and Finder rows never render the gallery. Keeping that
 * one-to-many relation out of their query prevents every image record from
 * crossing PostgREST just so the grid can use the denormalised hero URL.
 */
export const RACKET_CARD_SELECT = RACKET_COLUMNS.replace(
  "hero_image_url,",
  "hero_image_url, hero_thumb_url,",
);

export const RACKET_CARD_SELECT_NO_THUMBS = RACKET_COLUMNS;

/** True for the PostgREST error that means "this column is not in the schema
 *  yet", which is the only error the fallback select can fix. */
export function isMissingColumnError(message: string): boolean {
  return /column .* does not exist|could not find the .* column/i.test(message);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export function mapBrand(row: Row): Brand {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    country: row.country ?? "",
  };
}

function mapVariant(row: Row): RacketVariant {
  return {
    id: row.id,
    racketId: row.racket_id,
    weightClass: row.weight_class,
    weightGrams: row.weight_grams,
    gripSize: row.grip_size,
    colourway: row.colourway ?? null,
    sku: row.sku,
  };
}

export function mapRacketImage(row: Row): RacketImage {
  return {
    id: row.id,
    racketId: row.racket_id,
    provider: row.provider,
    sourceUrl: row.source_url,
    sourcePageUrl: row.source_page_url,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    publicUrl: row.public_url ?? null,
    thumbUrl: row.thumb_url ?? null,
    position: row.position ?? 0,
    isHero: Boolean(row.is_hero),
    contentType: row.content_type ?? null,
    bytes: row.bytes ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    checksum: row.checksum,
    colourway: row.colourway ?? null,
  };
}

export function mapRacket(row: Row): Racket {
  const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
  const images = (row.images ?? [])
    .map(mapRacketImage)
    .sort((a: RacketImage, b: RacketImage) => a.position - b.position);
  // Same hero for both: whichever row is flagged, else the first by position.
  const hero =
    images.find((img: RacketImage) => img.isHero) ?? images[0] ?? null;
  const heroFromGallery = hero?.publicUrl ?? null;
  const thumbFromGallery = hero?.thumbUrl ?? null;

  return {
    id: row.id,
    slug: row.slug,
    brandSlug: brand?.slug ?? "",
    brandName: brand?.name ?? "",
    name: row.name,
    releaseYear: row.release_year,
    balancePointMm: row.balance_point_mm,
    shaftFlex: row.shaft_flex,
    shaftDiameterMm: Number(row.shaft_diameter_mm),
    frameShape: row.frame_shape,
    frameMaterial: row.frame_material ?? [],
    maxTensionLbs: [row.max_tension_min_lbs, row.max_tension_max_lbs],
    lengthMm: row.length_mm,
    stringPattern: row.string_pattern,
    msrp: Number(row.msrp),
    currency: "VND",
    playStyleTags: row.play_style_tags ?? [],
    skillLevel: row.skill_level,
    heroImageUrl: row.hero_image_url ?? heroFromGallery,
    heroThumbUrl: row.hero_thumb_url ?? thumbFromGallery,
    images,
    summary: { en: row.summary_en ?? "", vi: row.summary_vi ?? "" },
    variants: (row.variants ?? []).map(mapVariant),
  };
}

export function mapSeller(row: Row): Seller {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tier: row.tier,
    city: row.city,
    rating: Number(row.rating ?? 0),
    ordersCount: row.orders_count ?? 0,
    disputeRate: Number(row.dispute_rate ?? 0),
    since: row.since ?? 2024,
    about: { en: row.about_en ?? "", vi: row.about_vi ?? "" },
  };
}

export function mapOffer(row: Row): Offer {
  return {
    id: row.id,
    variantId: row.variant_id,
    racketId: row.racket_id,
    sellerId: row.seller_id,
    price: Number(row.price),
    currency: "VND",
    qtyAvailable: row.qty_available ?? 0,
    condition: row.condition,
    warrantyMonths: row.warranty_months ?? 0,
    includesStringing: Boolean(row.includes_stringing),
    shipsFrom: row.ships_from ?? "",
    leadTimeDays: row.lead_time_days ?? 0,
    promoted: Boolean(row.promoted),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function mapPricePoint(row: Row): PricePoint {
  return {
    variantId: row.variant_id,
    observedOn: row.observed_on,
    price: Number(row.price),
  };
}

export function mapReview(row: Row): Review {
  return {
    id: row.id,
    racketId: row.racket_id,
    authorName: row.author_name ?? "",
    tier: row.tier,
    skillLevel: row.skill_level,
    format: row.format,
    position: row.position,
    stringModel: row.string_model ?? "",
    tensionLbs: row.tension_lbs ?? 0,
    power: Number(row.power),
    speed: Number(row.speed),
    control: Number(row.control),
    comfort: Number(row.comfort),
    body: { en: row.body_en ?? "", vi: row.body_vi ?? "" },
    createdAt: row.created_at,
  };
}

export function mapGuide(row: Row): Guide {
  return {
    slug: row.slug,
    title: { en: row.title_en ?? "", vi: row.title_vi ?? "" },
    excerpt: { en: row.excerpt_en ?? "", vi: row.excerpt_vi ?? "" },
    readMinutes: row.read_minutes ?? 0,
    tone: row.tone ?? "default",
  };
}
