import { createClient } from "@supabase/supabase-js";
import {
  brands,
  guides,
  offers,
  priceHistory,
  rackets,
  reviews,
  sellers,
} from "../src/lib/data/seed";

export async function seedDatabase() {
  console.log("=================================================");
  console.log("🌱 Shuttlecraft Database Seeder");
  console.log("=================================================\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("⚠️ Warning: Supabase environment variables not detected (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    console.log("Generating supabase/seed.sql offline seed file instead...");
    const { execSync } = await import("child_process");
    execSync("npx tsx scripts/generate-seed.ts", { stdio: "inherit" });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log(`📡 Connecting to Supabase instance at ${supabaseUrl}...`);

  // 1. Seed Brands
  console.log(`🔹 Ingesting ${brands.length} brands...`);
  const { error: brandErr } = await supabase.from("brands").upsert(
    brands.map((b) => ({ id: b.id, slug: b.slug, name: b.name, country: b.country })),
    { onConflict: "id" },
  );
  if (brandErr) console.error("Error seeding brands:", brandErr.message);

  // 2. Seed Rackets
  console.log(`🔹 Ingesting ${rackets.length} rackets...`);
  const racketRows = rackets.map((r) => {
    const brand = brands.find((b) => b.slug === r.brandSlug)!;
    return {
      id: r.id,
      slug: r.slug,
      brand_id: brand.id,
      name: r.name,
      release_year: r.releaseYear,
      balance_point_mm: r.balancePointMm,
      shaft_flex: r.shaftFlex,
      shaft_diameter_mm: r.shaftDiameterMm,
      frame_shape: r.frameShape,
      frame_material: r.frameMaterial,
      max_tension_min_lbs: r.maxTensionLbs[0],
      max_tension_max_lbs: r.maxTensionLbs[1],
      length_mm: r.lengthMm,
      string_pattern: r.stringPattern,
      msrp: r.msrp,
      currency: r.currency,
      play_style_tags: r.playStyleTags,
      skill_level: r.skillLevel,
      summary_en: r.summary.en,
      summary_vi: r.summary.vi,
    };
  });
  const { error: racketErr } = await supabase.from("rackets").upsert(racketRows, { onConflict: "id" });
  if (racketErr) console.error("Error seeding rackets:", racketErr.message);

  // 3. Seed Racket Variants
  const variantRows = rackets.flatMap((r) =>
    r.variants.map((v) => ({
      id: v.id,
      racket_id: v.racketId,
      weight_class: v.weightClass,
      weight_grams: v.weightGrams,
      grip_size: v.gripSize,
      colourway: v.colourway,
      sku: v.sku,
    })),
  );
  console.log(`🔹 Ingesting ${variantRows.length} racket variants...`);
  const { error: variantErr } = await supabase.from("racket_variants").upsert(variantRows, { onConflict: "id" });
  if (variantErr) console.error("Error seeding variants:", variantErr.message);

  // 4. Seed Sellers
  console.log(`🔹 Ingesting ${sellers.length} sellers...`);
  const sellerRows = sellers.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    tier: s.tier,
    city: s.city,
    rating: s.rating,
    orders_count: s.ordersCount,
    dispute_rate: s.disputeRate,
    since: s.since,
    about_en: s.about.en,
    about_vi: s.about.vi,
  }));
  const { error: sellerErr } = await supabase.from("sellers").upsert(sellerRows, { onConflict: "id" });
  if (sellerErr) console.error("Error seeding sellers:", sellerErr.message);

  // 5. Seed Offers
  console.log(`🔹 Ingesting ${offers.length} active marketplace offers...`);
  const offerRows = offers.map((o) => ({
    id: o.id,
    variant_id: o.variantId,
    racket_id: o.racketId,
    seller_id: o.sellerId,
    price: o.price,
    currency: o.currency,
    qty_available: o.qtyAvailable,
    condition: o.condition,
    warranty_months: o.warrantyMonths,
    includes_stringing: o.includesStringing,
    ships_from: o.shipsFrom,
    lead_time_days: o.leadTimeDays,
    promoted: o.promoted,
    status: o.status,
    updated_at: o.updatedAt,
  }));
  const { error: offerErr } = await supabase.from("offers").upsert(offerRows, { onConflict: "id" });
  if (offerErr) console.error("Error seeding offers:", offerErr.message);

  // 6. Seed Price History Points
  console.log(`🔹 Ingesting ${priceHistory.length} historical price points...`);
  const priceRows = priceHistory.map((p) => ({
    variant_id: p.variantId,
    observed_on: p.observedOn,
    price: p.price,
  }));
  const { error: priceErr } = await supabase
    .from("price_points")
    .upsert(priceRows, { onConflict: "variant_id,observed_on" });
  if (priceErr) console.error("Error seeding price points:", priceErr.message);

  // 7. Seed Guides & Reviews
  console.log(`🔹 Ingesting ${guides.length} buying guides and ${reviews.length} reviews...`);
  const guideRows = guides.map((g) => ({
    slug: g.slug,
    title_en: g.title.en,
    title_vi: g.title.vi,
    excerpt_en: g.excerpt.en,
    excerpt_vi: g.excerpt.vi,
    read_minutes: g.readMinutes,
    tone: g.tone,
  }));
  await supabase.from("guides").upsert(guideRows, { onConflict: "slug" });

  const reviewRows = reviews.map((r) => ({
    id: r.id,
    racket_id: r.racketId,
    author_name: r.authorName,
    tier: r.tier,
    skill_level: r.skillLevel,
    format: r.format,
    position: r.position,
    string_model: r.stringModel,
    tension_lbs: r.tensionLbs,
    power: r.power,
    speed: r.speed,
    control: r.control,
    comfort: r.comfort,
    body_en: r.body.en,
    body_vi: r.body.vi,
    status: "published",
    created_at: r.createdAt,
  }));
  await supabase.from("reviews").upsert(reviewRows, { onConflict: "id" });

  console.log("\n🎉 Database seeding finished successfully!");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed-db.ts")) {
  seedDatabase().catch((err) => {
    console.error("Database seeding failed:", err);
    process.exit(1);
  });
}
