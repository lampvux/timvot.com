export type FieldKind =
  | "text"
  | "textarea"
  | "url"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "multi-select"
  | "text-list"
  | "file";

export interface FieldOption {
  value: string;
  label: string;
}

export interface RelationConfig {
  table: string;
  valueColumn: string;
  labelColumn: string;
  orderColumn?: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
  relation?: RelationConfig;
  createOnly?: boolean;
  readOnlyOnEdit?: boolean;
  fullWidth?: boolean;
}

export interface ListColumn {
  name: string;
  label: string;
  kind?: "text" | "status" | "currency" | "date" | "boolean" | "image";
}

export type CollectionGroup = "Catalogue" | "Marketplace" | "Editorial";

export interface CollectionConfig {
  key: string;
  table: string;
  label: string;
  singular: string;
  description: string;
  group: CollectionGroup;
  primaryKey: string;
  autoKey?: boolean;
  orderBy: string;
  orderAscending?: boolean;
  searchColumns: string[];
  columns: ListColumn[];
  fields: FieldConfig[];
}

const shaftFlex = options("extra-stiff", "stiff", "medium", "flexible");
const frameShape = options("isometric", "conventional", "aero-box");
const weightClass = options("2U", "3U", "4U", "5U");
const gripSize = options("G4", "G5", "G6");
const skillLevel = options("beginner", "intermediate", "advanced");
const playStyle = options("attack", "all-round", "speed", "defence", "control");
const offerStatus = options("live", "paused", "review");

function options(...values: string[]): FieldOption[] {
  return values.map((value) => ({
    value,
    label: value
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  }));
}

const brandRelation: RelationConfig = {
  table: "brands",
  valueColumn: "id",
  labelColumn: "name",
  orderColumn: "name",
};

const racketRelation: RelationConfig = {
  table: "rackets",
  valueColumn: "id",
  labelColumn: "name",
  orderColumn: "name",
};

const variantRelation: RelationConfig = {
  table: "racket_variants",
  valueColumn: "id",
  labelColumn: "sku",
  orderColumn: "sku",
};

const sellerRelation: RelationConfig = {
  table: "sellers",
  valueColumn: "id",
  labelColumn: "name",
  orderColumn: "name",
};

const stringRelation: RelationConfig = {
  table: "strings",
  valueColumn: "id",
  labelColumn: "name",
  orderColumn: "name",
};

export const collections: Record<string, CollectionConfig> = {
  brands: {
    key: "brands",
    table: "brands",
    label: "Brands",
    singular: "Brand",
    description: "Manufacturers used by both racket and string catalogues.",
    group: "Catalogue",
    primaryKey: "id",
    orderBy: "name",
    searchColumns: ["id", "name", "slug", "country"],
    columns: [
      { name: "name", label: "Brand" },
      { name: "slug", label: "Slug" },
      { name: "country", label: "Country" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true, help: "Stable lowercase ID, for example yonex." },
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "slug", label: "Slug", kind: "text", required: true },
      { name: "country", label: "Country", kind: "text" },
    ],
  },
  rackets: {
    key: "rackets",
    table: "rackets",
    label: "Rackets",
    singular: "Racket",
    description: "Core product specifications, classifications, copy, and hero media.",
    group: "Catalogue",
    primaryKey: "id",
    orderBy: "created_at",
    orderAscending: false,
    searchColumns: ["id", "name", "slug"],
    columns: [
      { name: "hero_thumb_url", label: "Image", kind: "image" },
      { name: "name", label: "Racket" },
      { name: "brand_id", label: "Brand" },
      { name: "release_year", label: "Year" },
      { name: "msrp", label: "MSRP", kind: "currency" },
      { name: "skill_level", label: "Level", kind: "status" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true, help: "Stable ID such as r-astrox-88d-pro." },
      { name: "brand_id", label: "Brand", kind: "select", required: true, relation: brandRelation },
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "slug", label: "Slug", kind: "text", required: true },
      { name: "release_year", label: "Release year", kind: "number", required: true, min: 1990, max: 2100 },
      { name: "balance_point_mm", label: "Balance point (mm)", kind: "number", required: true, min: 260, max: 320 },
      { name: "shaft_flex", label: "Shaft flex", kind: "select", required: true, options: shaftFlex },
      { name: "shaft_diameter_mm", label: "Shaft diameter (mm)", kind: "number", required: true, min: 4, max: 12, step: 0.1 },
      { name: "frame_shape", label: "Frame shape", kind: "select", required: true, options: frameShape },
      { name: "frame_material", label: "Frame materials", kind: "text-list", required: true, help: "Comma-separated materials." },
      { name: "max_tension_min_lbs", label: "Minimum tension (lb)", kind: "number", required: true, min: 10, max: 50 },
      { name: "max_tension_max_lbs", label: "Maximum tension (lb)", kind: "number", required: true, min: 10, max: 50 },
      { name: "length_mm", label: "Length (mm)", kind: "number", required: true, min: 600, max: 750 },
      { name: "string_pattern", label: "String pattern", kind: "text", required: true, placeholder: "22 × 21" },
      { name: "msrp", label: "MSRP (VND)", kind: "number", required: true, min: 0, step: 1000 },
      { name: "currency", label: "Currency", kind: "select", required: true, options: options("VND") },
      { name: "play_style_tags", label: "Play styles / categories", kind: "multi-select", options: playStyle, fullWidth: true },
      { name: "skill_level", label: "Skill level", kind: "select", required: true, options: skillLevel },
      { name: "summary_en", label: "English summary", kind: "textarea", fullWidth: true },
      { name: "summary_vi", label: "Vietnamese summary", kind: "textarea", fullWidth: true },
    ],
  },
  "racket-variants": {
    key: "racket-variants",
    table: "racket_variants",
    label: "Racket variants",
    singular: "Racket variant",
    description: "Sellable weight, grip, colourway, and SKU combinations.",
    group: "Catalogue",
    primaryKey: "id",
    orderBy: "sku",
    searchColumns: ["id", "sku", "colourway"],
    columns: [
      { name: "sku", label: "SKU" },
      { name: "racket_id", label: "Racket" },
      { name: "weight_class", label: "Weight", kind: "status" },
      { name: "grip_size", label: "Grip" },
      { name: "colourway", label: "Colourway" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true },
      { name: "racket_id", label: "Racket", kind: "select", required: true, relation: racketRelation },
      { name: "sku", label: "SKU", kind: "text", required: true },
      { name: "weight_class", label: "Weight class", kind: "select", required: true, options: weightClass },
      { name: "weight_grams", label: "Weight (g)", kind: "number", required: true, min: 60, max: 120 },
      { name: "grip_size", label: "Grip size", kind: "select", required: true, options: gripSize },
      { name: "colourway", label: "Colourway", kind: "text" },
    ],
  },
  "racket-images": {
    key: "racket-images",
    table: "racket_images",
    label: "Racket images",
    singular: "Racket image",
    description: "Upload, remap, and organize public product-gallery images.",
    group: "Catalogue",
    primaryKey: "id",
    autoKey: true,
    orderBy: "crawled_at",
    orderAscending: false,
    searchColumns: ["id", "racket_id", "provider", "colourway", "storage_path", "source_page_url"],
    columns: [
      { name: "thumb_url", label: "Preview", kind: "image" },
      { name: "racket_id", label: "Racket" },
      { name: "provider", label: "Source" },
      { name: "colourway", label: "Colourway" },
      { name: "position", label: "Position" },
      { name: "is_hero", label: "Hero", kind: "boolean" },
    ],
    fields: [
      { name: "racket_id", label: "Racket mapping", kind: "select", required: true, relation: racketRelation, help: "Changing this mapping moves the original and thumbnail into the selected racket's brand/model folder." },
      { name: "image_file", label: "Image file", kind: "file", required: true, createOnly: true, fullWidth: true, help: "JPEG, PNG, WebP, AVIF, or GIF; maximum 15 MB." },
      { name: "position", label: "Gallery position", kind: "number", required: true, min: 0 },
      { name: "is_hero", label: "Use as hero image", kind: "boolean", help: "Keeps the racket's full-size hero and thumbnail pointers synchronized with this image." },
      { name: "colourway", label: "Colourway", kind: "text" },
      { name: "provider", label: "Provider", kind: "text", readOnlyOnEdit: true },
      { name: "source_page_url", label: "Source page URL or upload ID", kind: "text", fullWidth: true, help: "Leave blank for a unique admin-upload identifier, or retain the official manufacturer page URL." },
      { name: "storage_bucket", label: "Storage bucket", kind: "text", readOnlyOnEdit: true },
      { name: "storage_path", label: "Original image path", kind: "text", readOnlyOnEdit: true, fullWidth: true },
      { name: "public_url", label: "Public URL", kind: "url", readOnlyOnEdit: true, fullWidth: true },
      { name: "thumb_path", label: "Thumbnail path", kind: "text", readOnlyOnEdit: true, fullWidth: true },
      { name: "thumb_url", label: "Thumbnail URL", kind: "url", readOnlyOnEdit: true, fullWidth: true },
    ],
  },
  sellers: {
    key: "sellers",
    table: "sellers",
    label: "Sellers",
    singular: "Seller",
    description: "Marketplace storefronts, trust tier, service location, and reputation.",
    group: "Marketplace",
    primaryKey: "id",
    orderBy: "name",
    searchColumns: ["id", "name", "slug", "city"],
    columns: [
      { name: "name", label: "Seller" },
      { name: "city", label: "City" },
      { name: "tier", label: "Tier", kind: "status" },
      { name: "rating", label: "Rating" },
      { name: "orders_count", label: "Orders" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true },
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "slug", label: "Slug", kind: "text", required: true },
      { name: "tier", label: "Tier", kind: "select", required: true, options: options("authorised", "verified", "new") },
      { name: "city", label: "City", kind: "text", required: true },
      { name: "rating", label: "Rating", kind: "number", required: true, min: 0, max: 5, step: 0.1 },
      { name: "orders_count", label: "Orders", kind: "number", required: true, min: 0 },
      { name: "dispute_rate", label: "Dispute rate", kind: "number", required: true, min: 0, max: 1, step: 0.0001 },
      { name: "since", label: "Operating since", kind: "number", required: true, min: 1900, max: 2100 },
      { name: "owner_id", label: "Owner user UUID", kind: "text", help: "Optional Supabase Auth user ID for a seller-managed storefront." },
      { name: "about_en", label: "English description", kind: "textarea", fullWidth: true },
      { name: "about_vi", label: "Vietnamese description", kind: "textarea", fullWidth: true },
    ],
  },
  offers: {
    key: "offers",
    table: "offers",
    label: "Racket deals",
    singular: "Racket deal",
    description: "Seller pricing, availability, fulfillment, condition, and promotion state.",
    group: "Marketplace",
    primaryKey: "id",
    orderBy: "updated_at",
    orderAscending: false,
    searchColumns: ["id", "racket_id", "variant_id", "seller_id"],
    columns: [
      { name: "id", label: "Offer" },
      { name: "seller_id", label: "Seller" },
      { name: "racket_id", label: "Racket" },
      { name: "price", label: "Price", kind: "currency" },
      { name: "qty_available", label: "Stock" },
      { name: "status", label: "Status", kind: "status" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true },
      { name: "racket_id", label: "Racket", kind: "select", required: true, relation: racketRelation },
      { name: "variant_id", label: "Variant", kind: "select", required: true, relation: variantRelation },
      { name: "seller_id", label: "Seller", kind: "select", required: true, relation: sellerRelation },
      { name: "price", label: "Price (VND)", kind: "number", required: true, min: 0, step: 1000 },
      { name: "currency", label: "Currency", kind: "select", required: true, options: options("VND") },
      { name: "qty_available", label: "Available quantity", kind: "number", required: true, min: 0 },
      { name: "condition", label: "Condition", kind: "select", required: true, options: options("new", "open-box", "used-excellent", "used-good", "used-fair") },
      { name: "warranty_months", label: "Warranty (months)", kind: "number", required: true, min: 0 },
      { name: "includes_stringing", label: "Includes stringing", kind: "boolean" },
      { name: "ships_from", label: "Ships from", kind: "text" },
      { name: "lead_time_days", label: "Lead time (days)", kind: "number", required: true, min: 0 },
      { name: "promoted", label: "Promoted deal", kind: "boolean" },
      { name: "status", label: "Status", kind: "select", required: true, options: offerStatus },
    ],
  },
  "price-points": {
    key: "price-points",
    table: "price_points",
    label: "Racket price history",
    singular: "Racket price point",
    description: "Daily observed prices used by storefront price-history charts.",
    group: "Marketplace",
    primaryKey: "id",
    autoKey: true,
    orderBy: "observed_on",
    orderAscending: false,
    searchColumns: ["variant_id"],
    columns: [
      { name: "variant_id", label: "Variant" },
      { name: "observed_on", label: "Observed", kind: "date" },
      { name: "price", label: "Price", kind: "currency" },
    ],
    fields: [
      { name: "variant_id", label: "Variant", kind: "select", required: true, relation: variantRelation },
      { name: "observed_on", label: "Observed on", kind: "date", required: true },
      { name: "price", label: "Price (VND)", kind: "number", required: true, min: 0, step: 1000 },
    ],
  },
  strings: {
    key: "strings",
    table: "strings",
    label: "Strings",
    singular: "String",
    description: "String specifications, performance ratings, classifications, and copy.",
    group: "Catalogue",
    primaryKey: "id",
    orderBy: "name",
    searchColumns: ["id", "name", "slug"],
    columns: [
      { name: "thumb_url", label: "Image", kind: "image" },
      { name: "name", label: "String" },
      { name: "brand_id", label: "Brand" },
      { name: "gauge_mm", label: "Gauge" },
      { name: "feel", label: "Feel", kind: "status" },
      { name: "durability", label: "Durability" },
      { name: "repulsion", label: "Repulsion" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true },
      { name: "brand_id", label: "Brand", kind: "select", required: true, relation: brandRelation },
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "slug", label: "Slug", kind: "text", required: true },
      { name: "gauge_mm", label: "Gauge (mm)", kind: "number", required: true, min: 0.5, max: 0.9, step: 0.01 },
      { name: "cross_gauge_mm", label: "Cross gauge (mm)", kind: "number", min: 0.5, max: 0.9, step: 0.01 },
      { name: "feel", label: "Feel", kind: "select", required: true, options: options("soft", "medium", "hard") },
      { name: "durability", label: "Durability", kind: "number", required: true, min: 1, max: 5 },
      { name: "repulsion", label: "Repulsion", kind: "number", required: true, min: 1, max: 5 },
      { name: "control", label: "Control", kind: "number", required: true, min: 1, max: 5 },
      { name: "play_style_tags", label: "Play styles / categories", kind: "multi-select", options: playStyle, fullWidth: true },
      { name: "skill_levels", label: "Skill levels", kind: "multi-select", options: skillLevel, fullWidth: true },
      { name: "summary_en", label: "English summary", kind: "textarea", fullWidth: true },
      { name: "summary_vi", label: "Vietnamese summary", kind: "textarea", fullWidth: true },
    ],
  },
  "string-offers": {
    key: "string-offers",
    table: "string_offers",
    label: "String deals",
    singular: "String deal",
    description: "Seller prices and stock for string products.",
    group: "Marketplace",
    primaryKey: "id",
    orderBy: "updated_at",
    orderAscending: false,
    searchColumns: ["id", "string_id", "seller_id"],
    columns: [
      { name: "string_id", label: "String" },
      { name: "seller_id", label: "Seller" },
      { name: "price", label: "Price", kind: "currency" },
      { name: "qty_available", label: "Stock" },
      { name: "status", label: "Status", kind: "status" },
    ],
    fields: [
      { name: "id", label: "ID", kind: "text", required: true, readOnlyOnEdit: true },
      { name: "string_id", label: "String", kind: "select", required: true, relation: stringRelation },
      { name: "seller_id", label: "Seller", kind: "select", required: true, relation: sellerRelation },
      { name: "price", label: "Price (VND)", kind: "number", required: true, min: 0, step: 1000 },
      { name: "currency", label: "Currency", kind: "select", required: true, options: options("VND") },
      { name: "qty_available", label: "Available quantity", kind: "number", required: true, min: 0 },
      { name: "status", label: "Status", kind: "select", required: true, options: offerStatus },
    ],
  },
  "string-price-points": {
    key: "string-price-points",
    table: "string_price_points",
    label: "String price history",
    singular: "String price point",
    description: "Daily string-price observations used by storefront charts.",
    group: "Marketplace",
    primaryKey: "id",
    autoKey: true,
    orderBy: "observed_on",
    orderAscending: false,
    searchColumns: ["string_id"],
    columns: [
      { name: "string_id", label: "String" },
      { name: "observed_on", label: "Observed", kind: "date" },
      { name: "price", label: "Price", kind: "currency" },
    ],
    fields: [
      { name: "string_id", label: "String", kind: "select", required: true, relation: stringRelation },
      { name: "observed_on", label: "Observed on", kind: "date", required: true },
      { name: "price", label: "Price (VND)", kind: "number", required: true, min: 0, step: 1000 },
    ],
  },
  guides: {
    key: "guides",
    table: "guides",
    label: "Guides",
    singular: "Guide",
    description: "Bilingual editorial guides and publishing status.",
    group: "Editorial",
    primaryKey: "slug",
    orderBy: "slug",
    searchColumns: ["slug", "title_en", "title_vi"],
    columns: [
      { name: "title_en", label: "English title" },
      { name: "title_vi", label: "Vietnamese title" },
      { name: "read_minutes", label: "Read time" },
      { name: "published", label: "Published", kind: "boolean" },
    ],
    fields: [
      { name: "slug", label: "Slug", kind: "text", required: true, readOnlyOnEdit: true },
      { name: "title_en", label: "English title", kind: "text", required: true },
      { name: "title_vi", label: "Vietnamese title", kind: "text", required: true },
      { name: "excerpt_en", label: "English excerpt", kind: "textarea", fullWidth: true },
      { name: "excerpt_vi", label: "Vietnamese excerpt", kind: "textarea", fullWidth: true },
      { name: "body_en", label: "English body", kind: "textarea", fullWidth: true },
      { name: "body_vi", label: "Vietnamese body", kind: "textarea", fullWidth: true },
      { name: "read_minutes", label: "Read time (minutes)", kind: "number", required: true, min: 1 },
      { name: "tone", label: "Tone", kind: "select", required: true, options: options("default", "used") },
      { name: "published", label: "Published", kind: "boolean" },
    ],
  },
  reviews: {
    key: "reviews",
    table: "reviews",
    label: "Reviews",
    singular: "Review",
    description: "Community submissions, reviewer context, scores, copy, and moderation.",
    group: "Editorial",
    primaryKey: "id",
    autoKey: true,
    orderBy: "created_at",
    orderAscending: false,
    searchColumns: ["id", "racket_id", "author_name", "string_model"],
    columns: [
      { name: "author_name", label: "Author" },
      { name: "racket_id", label: "Racket" },
      { name: "tier", label: "Tier", kind: "status" },
      { name: "status", label: "Status", kind: "status" },
      { name: "created_at", label: "Submitted", kind: "date" },
    ],
    fields: [
      { name: "racket_id", label: "Racket", kind: "select", required: true, relation: racketRelation },
      { name: "author_name", label: "Author name", kind: "text", required: true },
      { name: "user_id", label: "Author user UUID", kind: "text" },
      { name: "tier", label: "Review tier", kind: "select", required: true, options: options("purchase", "owner", "community") },
      { name: "skill_level", label: "Skill level", kind: "select", required: true, options: skillLevel },
      { name: "format", label: "Format", kind: "select", required: true, options: options("singles", "doubles") },
      { name: "position", label: "Court position", kind: "select", required: true, options: options("net", "mid", "rear") },
      { name: "string_model", label: "String model", kind: "text", required: true },
      { name: "tension_lbs", label: "Tension (lb)", kind: "number", required: true, min: 15, max: 35 },
      { name: "power", label: "Power", kind: "number", required: true, min: 1, max: 5, step: 0.1 },
      { name: "speed", label: "Speed", kind: "number", required: true, min: 1, max: 5, step: 0.1 },
      { name: "control", label: "Control", kind: "number", required: true, min: 1, max: 5, step: 0.1 },
      { name: "comfort", label: "Comfort", kind: "number", required: true, min: 1, max: 5, step: 0.1 },
      { name: "body_en", label: "English review", kind: "textarea", fullWidth: true },
      { name: "body_vi", label: "Vietnamese review", kind: "textarea", fullWidth: true },
      { name: "status", label: "Moderation status", kind: "select", required: true, options: options("pending", "published", "rejected") },
    ],
  },
};

export const collectionGroups: CollectionGroup[] = [
  "Catalogue",
  "Marketplace",
  "Editorial",
];

export function getCollection(key: string): CollectionConfig | null {
  return collections[key] ?? null;
}

export function getCollectionsForGroup(group: CollectionGroup) {
  return Object.values(collections).filter((collection) => collection.group === group);
}
