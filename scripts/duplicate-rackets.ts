/**
 * Find catalogue rows that are one racket written two ways, and merge them.
 *
 *   npx tsx scripts/duplicate-rackets.ts             # report
 *   npx tsx scripts/duplicate-rackets.ts --apply     # merge them
 *   npx tsx scripts/duplicate-rackets.ts --brand=victor
 *   npx tsx scripts/duplicate-rackets.ts --slug=nanoflare-700 --apply
 *
 * `--slug=` narrows to the group a row belongs to, named by slug or id, comma
 * separated. It selects *groups*, not rows, so naming either spelling brings its
 * twin with it — which is what makes a merge reviewable one frame at a time
 * rather than 118 rows at once.
 *
 * Four Vietnamese storefronts name the same frame four ways, and the retailer
 * scrape creates a catalogue row from whatever each one called it. Victor is
 * the worst of it because the manufacturer itself ships two vocabularies: the
 * marketing name on the box and the model code in the spec sheet. `ARS 9` and
 * `Auraspeed 9` are the same racket; so are `TK-F` and `Thruster F`, `DX 09`
 * and `DriveX 09`, `JS-2SP` and `Jetspeed S 2SP`, `brs 1800 d` and
 * `Brave Sword 1800D`. Yonex contributes a quieter version — the hand-authored
 * seed used `astrox-88s-pro` while the crawler wrote `yonex-astrox-88s-pro`.
 *
 * The cost is not tidiness. A duplicate splits everything that hangs off a
 * racket: the gallery lands on one row and the other shows an empty page, the
 * offers are divided so neither page shows the real lowest price or seller
 * count, and reviews divide until neither row reaches the five that Court Score
 * needs. `images:reconcile` is what surfaced them — 34 bucket folders holding a
 * byte-identical copy of another row's gallery.
 *
 * ------------------------------------------------------------------
 * What counts as the same racket
 *
 * The series abbreviation is expanded and everything that is not a letter or a
 * digit is dropped, and then the two names must be *equal*. Nothing fuzzy:
 *
 *   ARS 9            → AURASPEED9        ← same
 *   Auraspeed 9      → AURASPEED9        ←
 *   Thruster K100    → THRUSTERK100      ← same
 *   Thruster K 100   → THRUSTERK100      ←
 *   Auraspeed 90k II → AURASPEED90KII    ← different from
 *   Auraspeed 90k II TD → AURASPEED90KIITD  ←
 *
 * That last pair is the reason equality is the rule. A suffix on a Victor or
 * Yonex name is a real product — `Astrox 22` and `Astrox 22 RX` are different
 * frames, and so are `Thruster Ryuga II` and `Thruster Ryuga II TD` — and a
 * matcher that tolerated a trailing token would merge them. `images/match.ts`
 * refuses rather than guesses for the same reason; this refuses harder, because
 * a bad image match shows the wrong photograph and a bad merge destroys a row.
 *
 * ------------------------------------------------------------------
 * Which row survives
 *
 * The one with the gallery, then the one with more offers, then the one whose
 * name is already the expanded form, then the model-only slug. The gallery
 * leads because it is the expensive thing to have acquired and the one the
 * ownership trigger will not let us simply copy across.
 *
 * The merge moves variants, offers, reviews and gallery rows onto the survivor
 * and deletes the loser. A variant collides when the survivor already has that
 * weight class and grip size — `racket_variants` is unique on
 * `(racket_id, weight_class, grip_size)` — and then the loser's offers are
 * repointed at the survivor's equivalent variant and the empty loser variant is
 * dropped. Prices follow their variant, so `price_points` needs no repair.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "./scraper/env";

const PAGE_SIZE = 1000;

/* ------------------------------------------------------------------ names */

/**
 * Series codes the manufacturers use interchangeably with the marketing name.
 *
 * Longest first, because `ARS` must be tried before `AR` would be — and each
 * is anchored to the start of the name, so a `TK` in the middle of a model
 * name is left alone.
 */
const SERIES_ALIASES: [RegExp, string][] = [
  // Victor
  [/^ARS\b/i, "AURASPEED"],
  [/^BRS\b/i, "BRAVESWORD"],
  [/^BS\b/i, "BRAVESWORD"],
  [/^TK[-\s]?RYUGA\b/i, "THRUSTERRYUGA"],
  [/^TK\b/i, "THRUSTER"],
  [/^DX\b/i, "DRIVEX"],
  [/^JS\b/i, "JETSPEEDS"],
  [/^CL\b/i, "COLUMBIA"],
  // Yonex
  [/^AX\b/i, "ASTROX"],
  [/^NF\b/i, "NANOFLARE"],
  [/^ARC\b/i, "ARCSABER"],
  [/^VT\b/i, "VOLTRIC"],
];

/**
 * Separators only — whitespace, hyphen, underscore, dot.
 *
 * These are the whole difference between `Jetspeed S12 M` and `Jetspeed S 12M`,
 * between `Active X-1` and `Active X1`, and they never distinguish two real
 * products. Every other character is kept, which is the difference between a
 * safe matcher and a destructive one:
 *
 *   Windstorm 78  ≠  Windstorm 78+     the plus is a model
 *   Ryuga TDC     ≠  Ryuga TD/C        the slash is two models
 *   Axforce 90 Tiger Max ≠ Axforce 90 Đỏ Tiger Max   the colourway is the row
 *
 * An earlier cut of this reduced to `[A-Z0-9]`, which deleted all three of
 * those and offered to merge each pair.
 */
const SEPARATORS = /[\s\-_.]/g;

/**
 * Drop the brand name when a source has written it into the model name.
 *
 * `rackets.brand_id` already carries the brand, so a name that repeats it is a
 * shop's page title leaking through rather than a fact about the frame:
 * `ProaceTGR F` and `TGR-F` are one racket filed twice. It runs before the
 * series alias, because those patterns are anchored to the start of the name and
 * a leading brand hides them — `Yonex AX 100 ZZ` has to become `AX 100 ZZ`
 * before `^AX` can expand it to `ASTROX`.
 *
 * Two guards keep it from eating a real name. A brand of under three characters
 * is left alone, because `VS` is also how a model is written; and something has
 * to remain, so a row named after nothing but its brand keeps that name instead
 * of reducing to the empty string and matching every other such row.
 *
 * The strip is only ever applied within one brand, so both spellings of a pair
 * lose the same prefix and no comparison crosses a brand boundary.
 */
function stripBrandPrefix(name: string, brandName?: string): string {
  if (!brandName) return name;
  const words = brandName.trim().split(SEPARATORS).filter(Boolean);
  if (words.join("").length < 3) return name;

  // Separators are allowed where the brand itself has one, and between the brand
  // and the model, so `Li-Ning`, `Li Ning` and `LiNing` are the same prefix.
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`^\\s*${escaped.join("[\\s\\-_.]*")}[\\s\\-_.]*`, "i");
  if (!pattern.test(name)) return name;

  const rest = name.replace(pattern, "");
  return rest.replace(SEPARATORS, "").length >= 2 ? rest : name;
}

/**
 * The comparable form of a model name: brand dropped, series code expanded,
 * separators gone.
 *
 * `brandName` is optional so the reduction can be reasoned about on its own, but
 * every caller that has a brand passes it.
 */
export function canonicalName(name: string, brandName?: string): string {
  let value = stripBrandPrefix(name.trim(), brandName);
  for (const [pattern, expansion] of SERIES_ALIASES) {
    if (pattern.test(value)) {
      value = value.replace(pattern, expansion);
      break;
    }
  }
  return value.toUpperCase().replace(SEPARATORS, "");
}

/* ------------------------------------------------------------------ types */

interface Racket {
  id: string;
  slug: string;
  name: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  heroImageUrl: string | null;
  heroThumbUrl: string | null;
}

interface Variant {
  id: string;
  racketId: string;
  weightClass: string;
  gripSize: string;
}

export interface Group {
  brandSlug: string;
  key: string;
  survivor: Racket;
  losers: Racket[];
  /** Set when the group cannot be merged; nothing is written for it. */
  blocked?: string;
}

interface Counts {
  images: Map<string, number>;
  offers: Map<string, number>;
  reviews: Map<string, number>;
}

/**
 * True when the name is already what it reduces to — no series code to expand
 * and no brand repeated in front of the model.
 */
function isExpanded(racket: Racket): boolean {
  return (
    canonicalName(racket.name, racket.brandName) ===
    racket.name.toUpperCase().replace(SEPARATORS, "")
  );
}

/**
 * Rank the rows in one group; the first is kept.
 *
 * The gallery leads, and not merely because it is expensive to have acquired:
 * `validate_racket_image_ownership` checks that `storage_path` still starts
 * with the owning racket's `<brand>/<model-slug>/`, so a gallery can only move
 * to a row whose slug the objects are already filed under. Moving Auraspeed 9's
 * gallery onto ARS 9 would be rejected by the trigger; keeping Auraspeed 9 is
 * the only direction that works.
 *
 * Reviews come next — five verified ones are what Court Score needs, and a
 * split pair can leave neither row reaching it — then the model-only slug,
 * which is the canonical public route the seed, reviews and editorial use.
 * Deterministic all the way down to the id so a dry run and the apply that
 * follows it choose the same survivor.
 */
export function rank(rackets: Racket[], counts: Counts): Racket[] {
  return [...rackets].sort((a, b) => {
    const images = (counts.images.get(b.id) ?? 0) - (counts.images.get(a.id) ?? 0);
    if (images !== 0) return images;
    const reviews = (counts.reviews.get(b.id) ?? 0) - (counts.reviews.get(a.id) ?? 0);
    if (reviews !== 0) return reviews;
    const prefixed =
      Number(a.slug.startsWith(`${a.brandSlug}-`)) - Number(b.slug.startsWith(`${b.brandSlug}-`));
    if (prefixed !== 0) return prefixed;
    const offers = (counts.offers.get(b.id) ?? 0) - (counts.offers.get(a.id) ?? 0);
    if (offers !== 0) return offers;
    // The expanded name over the code: `Auraspeed 9` reads as a product,
    // `ARS 9` reads as a SKU, and the survivor's name is what the page shows.
    const expanded = Number(isExpanded(b)) - Number(isExpanded(a));
    if (expanded !== 0) return expanded;
    return a.id.localeCompare(b.id);
  });
}

export function groupDuplicates(rackets: Racket[], counts: Counts): Group[] {
  const groups = new Map<string, Racket[]>();
  for (const racket of rackets) {
    const key = `${racket.brandId}|${canonicalName(racket.name, racket.brandName)}`;
    const group = groups.get(key) ?? [];
    group.push(racket);
    groups.set(key, group);
  }

  const duplicates: Group[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const ordered = rank(group, counts);
    const losers = ordered.slice(1);
    // Two galleries cannot both survive the move: the ownership trigger pins
    // each object's path to its owner's slug, so the loser's rows would be
    // rejected. Whichever gallery is the right one is a judgement about the
    // photographs, not something to decide by offer count.
    const withGallery = losers.filter((racket) => (counts.images.get(racket.id) ?? 0) > 0);
    duplicates.push({
      brandSlug: ordered[0].brandSlug,
      key: key.split("|")[1],
      survivor: ordered[0],
      losers,
      blocked: withGallery.length
        ? `both rows have a gallery (${withGallery.map((r) => r.id).join(", ")})`
        : undefined,
    });
  }

  return duplicates.sort(
    (a, b) => a.brandSlug.localeCompare(b.brandSlug) || a.key.localeCompare(b.key),
  );
}

/* --------------------------------------------------------------------- io */

async function readAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  order = "id",
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(order)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function tally(rows: { racket_id?: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row.racket_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Move one loser onto its survivor.
 *
 * Variants first, because the offers that hang off them have to be repointed
 * before the loser's rows can go; then the tables that reference the racket
 * directly. The loser is deleted last, so an interruption leaves a row whose
 * children have already moved — visible as an empty duplicate, repaired by
 * running this again — rather than orphaned children.
 */
async function merge(
  supabase: SupabaseClient,
  survivor: Racket,
  loser: Racket,
  variantsByRacket: Map<string, Variant[]>,
): Promise<string[]> {
  const notes: string[] = [];
  const survivorVariants = variantsByRacket.get(survivor.id) ?? [];
  const keyOf = (variant: Variant) => `${variant.weightClass}|${variant.gripSize}`;
  const survivorByKey = new Map(survivorVariants.map((variant) => [keyOf(variant), variant]));

  for (const variant of variantsByRacket.get(loser.id) ?? []) {
    const collision = survivorByKey.get(keyOf(variant));
    if (collision) {
      // The survivor already sells this weight and grip. Repoint the offers and
      // drop the now-empty duplicate variant; price history goes with it, which
      // is correct — it is the same variant's history under two ids and the
      // survivor's own series is the one the chart reads.
      const { error } = await supabase
        .from("offers")
        .update({ variant_id: collision.id, racket_id: survivor.id })
        .eq("variant_id", variant.id);
      if (error) return [...notes, `offers ${variant.id}: ${error.message}`];

      const { error: deleteError } = await supabase
        .from("racket_variants")
        .delete()
        .eq("id", variant.id);
      if (deleteError) return [...notes, `variant ${variant.id}: ${deleteError.message}`];
      notes.push(`variant ${variant.id} folded into ${collision.id}`);
      continue;
    }

    const { error } = await supabase
      .from("racket_variants")
      .update({ racket_id: survivor.id })
      .eq("id", variant.id);
    if (error) return [...notes, `variant ${variant.id}: ${error.message}`];
    const moved = { ...variant, racketId: survivor.id };
    survivorByKey.set(keyOf(moved), moved);
    survivorVariants.push(moved);
  }
  variantsByRacket.set(survivor.id, survivorVariants);
  variantsByRacket.delete(loser.id);

  for (const table of ["offers", "reviews", "racket_images"]) {
    const { error } = await supabase
      .from(table)
      .update({ racket_id: survivor.id })
      .eq("racket_id", loser.id);
    if (error) return [...notes, `${table}: ${error.message}`];
  }

  // A gallery that has just arrived needs the card pointer to follow it.
  if (!survivor.heroImageUrl && loser.heroImageUrl) {
    const { error } = await supabase
      .from("rackets")
      .update({ hero_image_url: loser.heroImageUrl, hero_thumb_url: loser.heroThumbUrl })
      .eq("id", survivor.id);
    if (error) return [...notes, `hero pointer: ${error.message}`];
    notes.push("hero pointer taken from the merged row");
  }

  const { error } = await supabase.from("rackets").delete().eq("id", loser.id);
  if (error) return [...notes, `delete ${loser.id}: ${error.message}`];
  return notes;
}

async function main(): Promise<void> {
  loadEnv();
  const flags = new Set(process.argv.slice(2));
  const apply = flags.has("--apply");
  const brandFilter = [...flags]
    .find((flag) => flag.startsWith("--brand="))
    ?.slice("--brand=".length);
  const slugFilter = new Set(
    [...flags]
      .find((flag) => flag.startsWith("--slug="))
      ?.slice("--slug=".length)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [],
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/key is missing from .env or .env.local");
  if (apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("--apply rewrites the catalogue and needs SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key);

  const [brands, racketRows, variantRows, imageRows, offerRows, reviewRows] = await Promise.all([
    readAll<{ id: string; slug: string; name: string }>(supabase, "brands", "id, slug, name"),
    readAll<Record<string, string | null>>(
      supabase,
      "rackets",
      "id, slug, name, brand_id, hero_image_url, hero_thumb_url",
    ),
    readAll<Record<string, string>>(
      supabase,
      "racket_variants",
      "id, racket_id, weight_class, grip_size",
    ),
    readAll<{ racket_id: string }>(supabase, "racket_images", "id, racket_id"),
    readAll<{ racket_id: string }>(supabase, "offers", "id, racket_id"),
    readAll<{ racket_id: string }>(supabase, "reviews", "id, racket_id"),
  ]);

  const brandSlugs = new Map(brands.map((brand) => [brand.id, brand.slug]));
  const brandNames = new Map(brands.map((brand) => [brand.id, brand.name]));
  const rackets: Racket[] = racketRows
    .filter((row) => brandSlugs.has(String(row.brand_id)))
    .map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      brandId: String(row.brand_id),
      brandSlug: brandSlugs.get(String(row.brand_id))!,
      brandName: brandNames.get(String(row.brand_id)) ?? "",
      heroImageUrl: row.hero_image_url === null ? null : String(row.hero_image_url),
      heroThumbUrl: row.hero_thumb_url === null ? null : String(row.hero_thumb_url),
    }))
    .filter((racket) => !brandFilter || racket.brandSlug === brandFilter);

  const counts: Counts = {
    images: tally(imageRows),
    offers: tally(offerRows),
    reviews: tally(reviewRows),
  };

  const variantsByRacket = new Map<string, Variant[]>();
  for (const row of variantRows) {
    const variant: Variant = {
      id: row.id,
      racketId: row.racket_id,
      weightClass: row.weight_class,
      gripSize: row.grip_size,
    };
    const group = variantsByRacket.get(variant.racketId) ?? [];
    group.push(variant);
    variantsByRacket.set(variant.racketId, group);
  }

  // Grouping happens over the whole brand and `--slug=` selects from the result,
  // so naming one spelling of a pair still finds the other. Filtering the rows
  // first would leave the named row alone in its group and report nothing.
  const all = groupDuplicates(rackets, counts);
  const groups = slugFilter.size
    ? all.filter((group) =>
        [group.survivor, ...group.losers].some(
          (racket) => slugFilter.has(racket.slug) || slugFilter.has(racket.id),
        ),
      )
    : all;

  // A name that matched nothing is worth saying out loud: it means the row has
  // no twin, or it is spelled differently from what was typed — not that the
  // catalogue is clean.
  const unmatched = [...slugFilter].filter(
    (value) =>
      !groups.some((group) =>
        [group.survivor, ...group.losers].some(
          (racket) => racket.slug === value || racket.id === value,
        ),
      ),
  );

  console.log("=================================================");
  console.log("🧬 Duplicate catalogue rows");
  console.log("=================================================");
  console.log(`Rackets considered : ${rackets.length}`);
  if (slugFilter.size) console.log(`Selected by --slug : ${groups.length} of ${all.length} groups`);
  console.log(`Duplicate groups   : ${groups.length}`);
  console.log(`Rows to merge away : ${groups.reduce((total, g) => total + g.losers.length, 0)}\n`);

  const show = (racket: Racket, label: string) =>
    `${label} ${racket.name} (${racket.id}) — ${counts.images.get(racket.id) ?? 0} images, ` +
    `${counts.offers.get(racket.id) ?? 0} offers, ${counts.reviews.get(racket.id) ?? 0} reviews`;

  for (const group of groups) {
    console.log(`${group.brandSlug}/${group.key}${group.blocked ? `  ⚠ skipped: ${group.blocked}` : ""}`);
    console.log(`  ${show(group.survivor, "keep  ")}`);
    for (const loser of group.losers) {
      console.log(`  ${show(loser, group.blocked ? "skip  " : "merge ")}`);
    }
  }

  if (unmatched.length) {
    console.log(`\n⚠ no duplicate group holds: ${unmatched.join(", ")}`);
  }

  const mergeable = groups.filter((group) => !group.blocked);
  const rows = mergeable.reduce((total, group) => total + group.losers.length, 0);
  if (!apply) {
    console.log(
      `\nReport only. ${rows} row(s) in ${mergeable.length} group(s) would be merged; ` +
        `${groups.length - mergeable.length} skipped. Re-run with --apply, after \`npm run backup\`.`,
    );
    return;
  }

  let merged = 0;
  for (const group of mergeable) {
    for (const loser of group.losers) {
      const notes = await merge(supabase, group.survivor, loser, variantsByRacket);
      const failed = notes.some((note) => note.includes(":"));
      console.log(`\n${loser.id} → ${group.survivor.id}${failed ? " ❌" : " ✅"}`);
      for (const note of notes) console.log(`  ${note}`);
      if (!failed) merged++;
    }
  }

  console.log(`\n✅ ${merged} row(s) merged.`);
  console.log("Now run `npm run market:refresh`, then `npm run images:audit`.");
}

if (process.argv[1]?.endsWith("duplicate-rackets.ts")) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
