/**
 * Emits the scraped catalogue as SQL.
 *
 * `--sync-db` needs a service-role key, because catalogue writes are admin-only
 * under RLS. When that key is not available — or the schema has not been
 * created yet — this produces the same rows as a file that can be applied with
 * psql or pasted into the Supabase SQL editor, which needs no key at all.
 *
 *   npx tsx scripts/scraper/generate-sql.ts [input.json] [output.sql]
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { slugify, type NormalizedItem } from "./normalizer";
import { brands as seedBrands } from "../../src/lib/data/seed";

const quote = (value: string | null | undefined): string =>
  value === null || value === undefined ? "null" : `'${value.replace(/'/g, "''")}'`;

const array = (values: string[]): string =>
  values.length === 0 ? "'{}'" : `ARRAY[${values.map(quote).join(", ")}]`;

/**
 * Upsert rather than "do nothing": a re-scrape should move prices, not be
 * silently discarded because the id already exists.
 */
function upsert(
  table: string,
  columns: string[],
  rows: string[][],
  conflict: string,
  update: string[],
): string {
  if (rows.length === 0) return "";
  const chunks: string[] = [];
  // Keep each statement to a size Postgres and the SQL editor handle happily.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const values = batch.map((row) => `  (${row.join(", ")})`).join(",\n");
    const setClause =
      update.length > 0
        ? `do update set ${update.map((c) => `${c} = excluded.${c}`).join(", ")}`
        : "do nothing";
    chunks.push(
      `insert into ${table} (${columns.join(", ")}) values\n${values}\n` +
        `on conflict (${conflict}) ${setClause};`,
    );
  }
  return chunks.join("\n\n") + "\n";
}

const WEIGHT_GRAMS: Record<string, number> = { "2U": 92, "3U": 87, "4U": 82, "5U": 77 };

export function buildSql(items: NormalizedItem[], scrapedAt: string): string {
  const observedOn = scrapedAt.slice(0, 10);

  const brands = new Map<string, string[]>();
  const rackets = new Map<string, string[]>();
  const variants = new Map<string, string[]>();
  const sellers = new Map<string, string[]>();
  const offers = new Map<string, string[]>();
  const pricePoints = new Map<string, { variantId: string; price: number }>();

  for (const item of items) {
    // A listing never states the brand's country, so take it from the seeded
    // catalogue where we know it and leave it null where we do not. Stamping
    // every brand 'VN' because the shops are Vietnamese would file Yonex as a
    // Vietnamese company.
    const seededBrand = seedBrands.find((b) => b.slug === item.brandSlug);
    brands.set(item.brandSlug, [
      quote(`b-${item.brandSlug}`),
      quote(item.brandSlug),
      quote(item.brandName),
      quote(seededBrand?.country ?? null),
    ]);

    const racketId = `r-${item.racketSlug}`;
    if (!rackets.has(racketId)) {
      rackets.set(racketId, [
        quote(racketId),
        quote(item.racketSlug),
        quote(`b-${item.brandSlug}`),
        quote(item.racketName),
        String(new Date(scrapedAt).getFullYear()),
        String(item.specs.balancePointMm ?? 295),
        `${quote(item.specs.shaftFlex ?? "medium")}::shaft_flex`,
        "6.8",
        `'isometric'::frame_shape`,
        array(["HM Graphite"]),
        String(item.specs.maxTensionLbs?.[0] ?? 20),
        String(item.specs.maxTensionLbs?.[1] ?? 28),
        "675",
        quote("22×21"),
        String(item.msrp),
        quote("VND"),
        `ARRAY['all-round']::play_style[]`,
        `'intermediate'::skill_level`,
      ]);
    }

    variants.set(item.variantId, [
      quote(item.variantId),
      quote(racketId),
      `${quote(item.weightClass)}::weight_class`,
      String(WEIGHT_GRAMS[item.weightClass] ?? 82),
      `${quote(item.gripSize)}::grip_size`,
      quote(item.colourway),
      quote(
        [
          item.brandSlug.toUpperCase(),
          item.racketSlug.slice(0, 12).toUpperCase(),
          item.weightClass,
          item.colourway ? slugify(item.colourway).slice(0, 10).toUpperCase() : null,
        ]
          .filter(Boolean)
          .join("-"),
      ),
    ]);

    sellers.set(item.sellerSlug, [
      quote(item.sellerSlug),
      quote(item.sellerSlug.replace(/^s-/, "")),
      quote(`${item.scraped.source.toUpperCase()} Store`),
      `'verified'::seller_tier`,
      quote("TP. Hồ Chí Minh"),
      "4.8",
      "500",
      "2020",
    ]);

    const offerId = `o-${item.scraped.source}-${item.scraped.externalId ?? item.racketSlug}`;
    offers.set(offerId, [
      quote(offerId),
      quote(item.variantId),
      quote(racketId),
      quote(item.sellerSlug),
      String(item.price),
      quote("VND"),
      String(item.qtyAvailable),
      `'new'::offer_condition`,
      `${quote(item.inStock ? "live" : "paused")}::offer_status`,
    ]);

    // One point per variant per day, holding the lowest offer seen.
    const existing = pricePoints.get(item.variantId);
    if (!existing || existing.price > item.price) {
      pricePoints.set(item.variantId, { variantId: item.variantId, price: item.price });
    }
  }

  const header = `-- Shuttlecraft scraped catalogue
--
-- Generated by scripts/scraper/generate-sql.ts from a live scrape of
-- shopvnb.com, qvbadminton.com, fbshop.vn and hvshop.vn.
--
--   scraped at : ${scrapedAt}
--   offers     : ${offers.size}
--   variants   : ${variants.size}
--   rackets    : ${rackets.size}
--   brands     : ${brands.size}
--
-- Apply the migrations in supabase/migrations first — this file assumes the
-- schema exists, including 20260818000000_variant_colourway_key.sql, without
-- which two colours of one racket in the same weight and grip collide.
--
-- Everything here is an upsert, so re-running it moves prices rather than
-- failing on existing ids.

begin;

`;

  const body = [
    upsert("brands", ["id", "slug", "name", "country"], [...brands.values()], "id", ["slug", "name"]),
    upsert(
      "sellers",
      ["id", "slug", "name", "tier", "city", "rating", "orders_count", "since"],
      [...sellers.values()],
      "id",
      ["name"],
    ),
    upsert(
      "rackets",
      [
        "id", "slug", "brand_id", "name", "release_year", "balance_point_mm", "shaft_flex",
        "shaft_diameter_mm", "frame_shape", "frame_material", "max_tension_min_lbs",
        "max_tension_max_lbs", "length_mm", "string_pattern", "msrp", "currency",
        "play_style_tags", "skill_level",
      ],
      [...rackets.values()],
      "id",
      ["name", "brand_id", "msrp", "shaft_flex", "balance_point_mm"],
    ),
    upsert(
      "racket_variants",
      ["id", "racket_id", "weight_class", "weight_grams", "grip_size", "colourway", "sku"],
      [...variants.values()],
      "id",
      ["colourway", "sku", "weight_grams"],
    ),
    upsert(
      "offers",
      ["id", "variant_id", "racket_id", "seller_id", "price", "currency", "qty_available", "condition", "status"],
      [...offers.values()],
      "id",
      ["price", "qty_available", "status"],
    ),
    upsert(
      "price_points",
      ["variant_id", "observed_on", "price"],
      [...pricePoints.values()].map((p) => [quote(p.variantId), quote(observedOn), String(p.price)]),
      "variant_id, observed_on",
      ["price"],
    ),
  ].join("\n");

  return `${header}${body}\ncommit;\n`;
}

function main() {
  const input = process.argv[2] ?? "scripts/scraper/output/rackets.json";
  const output = process.argv[3] ?? "supabase/scraped-catalogue.sql";

  const raw = JSON.parse(readFileSync(resolve(process.cwd(), input), "utf8"));
  const items: NormalizedItem[] = raw.items ?? [];
  if (items.length === 0) {
    console.error(`❌ ${input} contains no items.`);
    process.exit(1);
  }

  const sql = buildSql(items, raw.scrapedAt ?? new Date().toISOString());
  const outPath = resolve(process.cwd(), output);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, sql, "utf8");

  const kb = Math.round(Buffer.byteLength(sql, "utf8") / 1024);
  console.log(`💾 Wrote ${output} — ${items.length} scraped offers, ${kb} KB.`);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scraper/generate-sql.ts");
if (invokedDirectly) main();
