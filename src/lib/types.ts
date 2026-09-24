/**
 * The spec schema. Defined once, here, because these fields become the filter
 * facets, the comparison rows and the Finder quiz inputs. Changing a field
 * name is a schema migration, not a refactor.
 */

export type WeightClass = "2U" | "3U" | "4U" | "5U";
export type GripSize = "G4" | "G5" | "G6";
export type ShaftFlex = "extra-stiff" | "stiff" | "medium" | "flexible";
export type FrameShape = "isometric" | "conventional" | "aero-box";
export type BalanceType = "head-light" | "even" | "head-heavy";
export type SkillLevel = "beginner" | "intermediate" | "advanced";
export type PlayStyle = "attack" | "all-round" | "speed" | "defence" | "control";
export type Condition =
  | "new"
  | "open-box"
  | "used-excellent"
  | "used-good"
  | "used-fair";
export type SellerTier = "authorised" | "verified" | "new";
export type ReviewTier = "purchase" | "owner" | "community";
export type MatchFormat = "singles" | "doubles";
export type CourtPosition = "net" | "mid" | "rear";

/** The 280–305 mm rule the whole brand hangs off. */
export const BALANCE_MIN_MM = 280;
export const BALANCE_MAX_MM = 305;
export const EVEN_BAND_MIN_MM = 285;
export const EVEN_BAND_MAX_MM = 295;

export const WEIGHT_CLASS_GRAMS: Record<WeightClass, [number, number]> = {
  "2U": [90, 94],
  "3U": [85, 89],
  "4U": [80, 84],
  "5U": [75, 79],
};

export interface Brand {
  id: string;
  slug: string;
  name: string;
  country: string;
}

export interface RacketVariant {
  id: string;
  racketId: string;
  weightClass: WeightClass;
  weightGrams: number;
  gripSize: GripSize;
  colourway: string | null;
  sku: string;
}

export interface RacketImage {
  id: string;
  racketId: string;
  provider: string;
  sourceUrl: string;
  sourcePageUrl: string;
  storageBucket: string;
  storagePath: string;
  publicUrl: string | null;
  /** ~400px webp derived at crawl time. Null means fall back to publicUrl. */
  thumbUrl: string | null;
  position: number;
  isHero: boolean;
  contentType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  checksum: string;
  colourway: string | null;
}

export interface Racket {
  id: string;
  slug: string;
  brandSlug: string;
  brandName: string;
  name: string;
  releaseYear: number;

  balancePointMm: number;
  shaftFlex: ShaftFlex;
  shaftDiameterMm: number;
  frameShape: FrameShape;
  frameMaterial: string[];
  maxTensionLbs: [number, number];
  lengthMm: number;
  stringPattern: string;
  msrp: number;
  currency: "VND";
  playStyleTags: PlayStyle[];
  skillLevel: SkillLevel;

  variants: RacketVariant[];
  heroImageUrl: string | null;

  /**
   * The hero image resized to card size at crawl time.
   *
   * The catalogue grid serves this directly with `unoptimized`, which is what
   * keeps 3.010 rackets inside Vercel Hobby's 5.000 image transformations a
   * month. Null means no thumbnail was crawled and the card falls back to
   * `heroImageUrl` through the optimizer.
   */
  heroThumbUrl: string | null;
  images?: RacketImage[];

  /** Editorial one-liner, the "knowledgeable shop owner" sentence. */
  summary: { en: string; vi: string };
}

export interface Seller {
  id: string;
  slug: string;
  name: string;
  tier: SellerTier;
  city: string;
  rating: number;
  ordersCount: number;
  disputeRate: number;
  since: number;
  about: { en: string; vi: string };
}

export interface Offer {
  id: string;
  variantId: string;
  racketId: string;
  sellerId: string;
  price: number;
  currency: "VND";
  qtyAvailable: number;
  condition: Condition;
  warrantyMonths: number;
  includesStringing: boolean;
  shipsFrom: string;
  leadTimeDays: number;
  promoted: boolean;
  status: "live" | "paused" | "review";
  updatedAt: string;
}

/** One observed price for one variant on one day. */
export interface PricePoint {
  variantId: string;
  observedOn: string;
  price: number;
}

export interface Review {
  id: string;
  racketId: string;
  authorName: string;
  tier: ReviewTier;
  skillLevel: SkillLevel;
  format: MatchFormat;
  position: CourtPosition;
  stringModel: string;
  tensionLbs: number;
  /** 1–5 on the same four axes as the spec profile. */
  power: number;
  speed: number;
  control: number;
  comfort: number;
  body: { en: string; vi: string };
  createdAt: string;
}

export interface Guide {
  slug: string;
  hasContent?: boolean;
  title: { en: string; vi: string };
  excerpt: { en: string; vi: string };
  readMinutes: number;
  tone: "default" | "used";
}

export interface WatchlistEntry {
  id: string;
  userId: string;
  variantId: string;
  targetPrice: number | null;
  createdAt: string;
}

/** What the catalogue and detail pages actually render. */
export interface RacketWithMarket extends Racket {
  balanceType: BalanceType;
  spec: AxisScores;
  player: AxisScores | null;
  reviewCount: number;
  /** null until the racket has enough verified reviews for a player half. */
  courtScore: number | null;
  /** The spec half on its own, always available. */
  specScore: number;
  lowestPrice: number | null;
  sellerCount: number;
  history: PricePoint[];
}

/**
 * What a catalogue card needs, and nothing more.
 *
 * The axis breakdowns and the price series belong to the detail page, which
 * computes them from a racket's full review and price history. A card shows
 * neither, and the paginated catalogue read never fetches them — so this is the
 * shape it can honestly return. `RacketWithMarket` satisfies it, which is why
 * the detail page and comparison can pass their richer objects to the same card
 * without a conversion.
 */
export type CatalogRacket = Omit<RacketWithMarket, "spec" | "player" | "history">;

/**
 * The exact data a catalogue card renders.
 *
 * Detail-page recommendations cross a Route Handler boundary after they enter
 * the viewport. Keeping this shape separate prevents the client response from
 * carrying the full specification sheet, gallery, scores and price history for
 * three cards that use none of them.
 */
export type RacketCardData = Pick<
  CatalogRacket,
  | "id"
  | "slug"
  | "brandSlug"
  | "brandName"
  | "name"
  | "releaseYear"
  | "balancePointMm"
  | "shaftFlex"
  | "msrp"
  | "playStyleTags"
  | "heroImageUrl"
  | "heroThumbUrl"
  | "balanceType"
  | "lowestPrice"
  | "sellerCount"
> & {
  variants: Pick<RacketVariant, "weightClass" | "weightGrams">[];
};

export interface AxisScores {
  power: number;
  speed: number;
  control: number;
  comfort: number;
}

export interface OfferWithSeller extends Offer {
  seller: Seller;
  variant: RacketVariant;
}

export type StringFeel = "soft" | "medium" | "hard";

export interface BadmintonString {
  id: string;
  slug: string;
  brandSlug: string;
  brandName: string;
  name: string;
  gaugeMm: number;
  crossGaugeMm: number | null;
  feel: StringFeel;
  durability: number;
  repulsion: number;
  control: number;
  playStyleTags: PlayStyle[];
  skillLevels: SkillLevel[];
  summary: { en: string; vi: string };
  /** Stored packshot in the `string-images` bucket; null until one is added. */
  imageUrl: string | null;
  /** 400px WebP of imageUrl for lists; null when the original is that small. */
  thumbUrl: string | null;
}

export interface StringOffer {
  id: string;
  stringId: string;
  sellerId: string;
  price: number;
  currency: "VND";
  qtyAvailable: number;
  status: "live" | "paused" | "review";
  updatedAt: string;
}

export interface StringOfferWithSeller extends StringOffer {
  seller: Seller;
}

export interface StringPricePoint {
  stringId: string;
  observedOn: string;
  price: number;
}

export interface StringWithMarket extends BadmintonString {
  lowestPrice: number | null;
  sellerCount: number;
  history: StringPricePoint[];
}

export type SortKey = "popular" | "score" | "price-asc" | "price-desc" | "new";

export interface CatalogFilters {
  brands: string[];
  weightClasses: WeightClass[];
  balanceTypes: BalanceType[];
  flexes: ShaftFlex[];
  priceMin: number | null;
  priceMax: number | null;
  query: string;
  sort: SortKey;
}

export const EMPTY_FILTERS: CatalogFilters = {
  brands: [],
  weightClasses: [],
  balanceTypes: [],
  flexes: [],
  priceMin: null,
  priceMax: null,
  query: "",
  sort: "popular",
};
