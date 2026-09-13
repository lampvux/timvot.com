/**
 * Reading a VS racket's specification out of a Vietnamese description block.
 *
 * Two sites publish VS's specification — venson.vn, the brand's own WooCommerce
 * property, and vssports.vn, the VS Sports store — and they publish it the same
 * way: a run of `label: value` lines inside the product description, in the same
 * vocabulary, with the same habit of writing each label three or four different
 * ways. `venson-catalogue.ts` and `vssports-catalogue.ts` both read that, so the
 * reading lives here once rather than as two copies drifting apart.
 *
 * What the block publishes per racket, where it publishes anything:
 *
 *   Trọng lượng : 4U (82 ± 2g)   → weight_class, and weight_grams from the
 *                                  gram figure where there is one
 *   Điểm cân bằng : 300 ± 3mm    → balance_point_mm, the centre of the tolerance
 *   Mức căng : 24 – 28 Lbs       → max_tension_min_lbs / max_tension_max_lbs;
 *                                  a listing that quotes only kilos is converted
 *   Độ cứng : Cứng               → shaft_flex, through `extractFlex`
 *   Chất liệu : Japan Ultra High Modulus Carbon Graphite → frame_material
 *   Độ dày đũa vợt : 6.2 mm      → shaft_diameter_mm
 *   Chu vi cán cầm : G5          → the variant's grip_size
 *   Độ dài : 675 mm              → length_mm
 *   Số lỗ gen : 72               → read and reported; there is no column for it,
 *                                  and `string_pattern` is a pattern rather than
 *                                  a count, so inventing one from the other
 *                                  would be a guess dressed as a measurement
 *
 * Every fact is matched on the *phrase* that identifies it rather than on a
 * whole label, because there is no canonical label on either site: weight is
 * "Trọng lượng", "Trọng lượng vợt (không dây)", "Khối lượng", "Cân nặng" or
 * "Trọng lượng vợt cầu lông VS Longbow"; tension is "Mức căng", "Mức căng dây
 * tối đa", "Sức căng lưới", "Độ căng khuyến nghị", "Lực căng tối đa" or "Xâu
 * chuỗi"; balance is "Điểm cân bằng", "Độ cân bằng", "Cân bằng" or "Điểm nặng
 * đầu"; the grip is "Chu vi cán cầm", "Tay cầm", "Chuôi cầm" or "Kích thước
 * cán". Every spelling below was read off a real listing on one of the two.
 *
 * Balance is tested before tension on purpose: "độ cân bằng" and "độ căng" are
 * one diacritic apart.
 *
 * The first reading of a fact wins, and each is bounded by what it can possibly
 * be — which is what makes a shop's own mislabelling harmless. Windsoul Fengling
 * on venson.vn publishes "Cân nặng: 22-30 lbs", its string tension under the
 * weight label; 22 is not a mass a racket can have, so `parseWeight` returns
 * nothing and the row keeps no weight rather than a wrong one.
 *
 * A `label: value` line that is none of these and none of `IGNORED_LABELS` is
 * kept in `unparsed` and reported, which is how the next spelling gets noticed.
 * Only a short value is: a colon on these shops introduces a paragraph about as
 * often as it introduces a measurement.
 */

import { cleanText } from "./http";
import { extractFlex } from "./normalizer";
import type { GripSize, ShaftFlex, WeightClass } from "../../src/lib/types";

/**
 * A Vietnamese letter — anything outside ASCII. What separates a VS model name,
 * and a VS lay-up, from the prose around it.
 */
export const VIETNAMESE = /[^\u0000-\u007F]/;

/**
 * A Vietnamese *letter*, which is not the same test.
 *
 * VS writes its lay-ups with typographic punctuation — "Hot-Melt Carbon – HM
 * Carbon", "30T – 40T", "84 kg/cm²" — and an en dash is outside ASCII without
 * being a word in Vietnamese. Testing a material segment with `VIETNAMESE`
 * therefore threw away 65 of the 121 "Chất liệu" values on vssports.vn, every
 * one of them a perfectly good English lay-up with a dash in the middle.
 *
 * So the test for prose is "carries a letter that is not an ASCII letter", and
 * the punctuation passes through. `VIETNAMESE` stays what it is because the
 * *name* reduction depends on it: there, a word is a word.
 */
const VIETNAMESE_LETTER = /[^\P{L}\u0000-\u007F]/u;

/* ------------------------------------------------------------ the spec block */

/**
 * The description, as lines.
 *
 * Both shops store it as HTML with the entities already encoded, so the tags
 * become line breaks and `cleanText` decodes what is left. The spec block is a
 * run of `label: value` lines, each usually opened with an en dash or a bullet.
 */
export function descriptionLines(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) => cleanText(line).replace(/^[-–—•]\s*/, ""))
    .filter(Boolean);
}

/** `4U (82 ± 2g)`, `82±2 (4U)`, `82 ± 2g`, `4U (80 – 85g)`, `4U`. */
export function parseWeight(value: string): {
  weightClass: WeightClass | null;
  grams: number | null;
} {
  const grade = /(?:^|[^A-Z0-9])([2-7])U(?:[^A-Z0-9]|$)/i.exec(value);
  // 6U is a real VS grade and the schema's enum stops at 5U, so a lighter frame
  // lands in the lightest band there is. Naming it in the report is the closest
  // the schema can come; inventing a band would not be.
  const weightClass = grade
    ? ((grade[1] === "6" || grade[1] === "7" ? "5U" : `${grade[1]}U`) as WeightClass)
    : null;

  // The gram figure, which is a tolerance ("82 ± 2g") or a range ("80 – 85g").
  // A grade in parentheses looks like neither, so the digits are only accepted
  // where they land in the range a racket can actually weigh.
  let grams: number | null = null;
  const range = /(\d{2,3})\s*(?:g\b|[±+]\s*-?\s*\d+\s*g?|[-–~]\s*(\d{2,3})\s*g?)/i.exec(value);
  if (range) {
    const low = parseInt(range[1], 10);
    const high = range[2] ? parseInt(range[2], 10) : low;
    const mid = Math.round((low + high) / 2);
    if (mid >= 60 && mid <= 120) grams = mid;
  }

  return { weightClass, grams };
}

/** The weight bands the rest of the pipeline uses (see `generate-sql.ts`). */
export function weightClassOf(grams: number): WeightClass {
  if (grams >= 90) return "2U";
  if (grams >= 85) return "3U";
  if (grams >= 80) return "4U";
  return "5U";
}

/** `300 ± 3mm`, `295+-3mm`, `Khoảng 292mm`, `305 - 310 mm`. */
export function parseBalanceMm(value: string): number | null {
  const range = /(\d{3})\s*(?:[-–]\s*(\d{3}))?/.exec(value);
  if (!range) return null;
  const low = parseInt(range[1], 10);
  const high = range[2] ? parseInt(range[2], 10) : low;
  const mid = Math.round((low + high) / 2);
  return mid >= 250 && mid <= 340 ? mid : null;
}

/**
 * `24 – 28 Lbs`, `22-30LBS`, `28LBS ~ 12.5kg`, `13.5 kg`.
 *
 * Pounds win wherever the line quotes both, because that is the unit the columns
 * are in and converting a rounded kilo figure back loses a pound either way. A
 * line that quotes only kilos is converted, and a single figure is read as the
 * maximum with the six-pound window `normalizer.extractMaxTension` uses.
 */
export function parseTension(value: string): [number, number] | null {
  const lbs = /(\d{2})\s*(?:[-–~]\s*(\d{2})\s*)?lbs?/i.exec(value);
  if (lbs) {
    const low = parseInt(lbs[1], 10);
    const high = lbs[2] ? parseInt(lbs[2], 10) : low;
    if (low >= 12 && high <= 40 && high >= low) {
      return lbs[2] ? [low, high] : [Math.max(12, high - 6), high];
    }
  }

  const kg = /(\d{1,2}(?:[.,]\d)?)\s*kg/i.exec(value);
  if (kg) {
    const max = Math.round(parseFloat(kg[1].replace(",", ".")) * 2.20462);
    if (max >= 18 && max <= 40) return [Math.max(12, max - 6), max];
  }

  return null;
}

/**
 * The shaft's diameter, off a "Độ dày đũa vợt" line: `6.2 mm`, `6,5 mm Nano
 * Carbon siêu mỏng`.
 *
 * Bounded to what a badminton shaft is, which is what keeps a line that gives
 * the *frame* thickness, or the length in the same breath, from landing here.
 *
 * The figure may not be preceded by another digit. "675 mm" is the frame length
 * and an unanchored one-digit match reads the 5 out of the middle of it as a
 * 5 mm shaft — which is inside the bound, so the bound alone does not save it.
 */
export function parseShaftDiameterMm(value: string): number | null {
  const mm = /(?<![\d.,])(\d(?:[.,]\d)?)\s*mm/i.exec(value);
  if (!mm) return null;
  const diameter = parseFloat(mm[1].replace(",", "."));
  return diameter >= 5 && diameter <= 8.5 ? diameter : null;
}

/**
 * The materials out of a material or construction line, and nothing else.
 *
 * The line is either a lay-up in Latin script — "Japan Ultra High Modulus Carbon
 * Graphite", "30T MITSUBISHI CARBON SHEET+HEXAGON BLADE FRAME", "Blade Frame
 * Gen 2" — or a Vietnamese sentence describing one, "Sợi carbon chịu nhiệt cao",
 * "Khung hộp phá gió, độ đàn hồi cao". A segment carrying a Vietnamese letter is
 * prose and is dropped, which is the same test `fleet-catalogue.ts` makes on the
 * same kind of line; what is left is what the frame is made of. A long segment
 * is a sentence written without diacritics.
 */
export function parseMaterials(value: string): string[] {
  const out = new Set<string>();
  for (const raw of value.split(/[,;+/]|\.(?:\s|$)/)) {
    let segment = cleanText(raw).trim();

    // "(Đúc hai lần)" — a value written wholly inside parentheses is the value.
    if (/^\([^()]*\)$/.test(segment)) segment = segment.slice(1, -1).trim();

    // "MHE Carbon (Multi Layer High Elasticity Carbon" — the split above cut a
    // parenthesised gloss in half, because the gloss has a comma in it. What is
    // left of the bracket is not a material name, so the name is kept and the
    // half-sentence is dropped. A gloss that survived whole is left alone.
    const open = segment.indexOf("(");
    if (open >= 0 && !segment.slice(open).includes(")")) segment = segment.slice(0, open).trim();

    if (!segment || segment.length > 48) continue;
    if (!/[A-Za-z]/.test(segment)) continue;
    if (VIETNAMESE_LETTER.test(segment)) continue;
    out.add(segment);
  }
  return [...out];
}

/**
 * The shaft's stiffness, off a "Độ cứng" line.
 *
 * `extractFlex` is the shared reader and it scans for the grade words anywhere
 * in what it is given, which is right for a retailer title and wrong for this
 * line: VS glosses the grade it just gave — "Trung bình (giữa cứng và dẻo)",
 * medium, *between* stiff and flexible — and the gloss names both of the grades
 * the frame is not. So the parenthetical comes off first, and what the shop
 * actually answered is what is read.
 */
function parseFlex(value: string): ShaftFlex {
  return extractFlex(value.replace(/\s*\(.*$/, "").trim() || value);
}

export interface ParsedSpecs {
  weightClass: WeightClass | null;
  weightGrams: number | null;
  gripSize: GripSize | null;
  balancePointMm: number | null;
  tensionLbs: [number, number] | null;
  shaftDiameterMm: number | null;
  holes: number | null;
  lengthMm: number | null;
  materials: string[];
  shaftFlex: ShaftFlex | null;
  unparsed: string[];
}

/**
 * Labels these shops publish that are read and deliberately not used.
 *
 * They are listed rather than ignored so that `unparsed` stays a signal about a
 * shop changing its template, instead of a list of the same twenty lines every
 * run.
 *
 * The brand is the provider by definition. The colour and the product name are
 * things the catalogue keeps elsewhere — on the variant, and in the row's own
 * name. Swing weight has no column and no agreed unit between the two sites
 * ("84 kg/cm²" is not a mass). And the rest are the shops' own editorial about
 * how a frame plays ("Loại vợt: Thiên công", "Phân loại lối đánh: Tấn công
 * nhanh", "Đối tượng: Người chơi tấn công", every named technology) which would
 * have to be read through a vocabulary of marketing phrases to become
 * `play_style_tags` or `skill_level` — a guess wearing a regex, and the same
 * call `fleet-catalogue.ts` makes about the same copy.
 */
const IGNORED_LABELS =
  /thương hiệu|màu|tên sản phẩm|^sản phẩm|mẫu mã|^loại|phân loại|lối (?:chơi|đánh)|kiểu vợt|phong cách|đối tượng|công nghệ|swing|ưu điểm|đặc điểm|điểm (?:nổi bật|swing)|độ (?:ổn định|bền)|chuyển giao|hiệu suất|chi phí|đổi 1|bảo hành|khuyến mãi/;

/** Read the specification out of one product description. */
export function parseSpecs(descriptionHtml: string): ParsedSpecs {
  const specs: ParsedSpecs = {
    weightClass: null,
    weightGrams: null,
    gripSize: null,
    balancePointMm: null,
    tensionLbs: null,
    shaftDiameterMm: null,
    holes: null,
    lengthMm: null,
    materials: [],
    shaftFlex: null,
    unparsed: [],
  };

  for (const line of descriptionLines(descriptionHtml)) {
    // "Hệ thống 76 lỗ gen" is the one fact stated as a sentence rather than as a
    // label, and "Số lỗ gen: 72" is the same fact with a label.
    const holes = /(?:hệ thống|số lỗ)\D{0,12}?(\d{2,3})\s*lỗ|số\s+lỗ[^:]*:\s*(\d{2,3})/i.exec(line);
    if (holes) {
      specs.holes ??= parseInt(holes[1] ?? holes[2], 10);
      continue;
    }

    const row = /^([^:]{1,48}?)\s*:\s*(.*)$/.exec(line);
    if (!row) continue;
    const label = row[1].toLowerCase();
    const value = cleanText(row[2]);
    if (!value) continue;

    if (/trọng lượng|khối lượng|cân nặng/.test(label)) {
      const weight = parseWeight(value);
      specs.weightClass ??= weight.weightClass;
      specs.weightGrams ??= weight.grams;
    } else if (/cân bằng|nặng đầu/.test(label)) {
      specs.balancePointMm ??= parseBalanceMm(value);
    } else if (/(?:mức|sức|lực|độ)\s+căng|căng\s+tối\s+đa|xâu\s+chuỗi/.test(label)) {
      specs.tensionLbs ??= parseTension(value);
    } else if (/độ\s+(?:cứng|dẻo)/.test(label)) {
      specs.shaftFlex ??= parseFlex(value);
    } else if (/độ dày/.test(label)) {
      specs.shaftDiameterMm ??= parseShaftDiameterMm(value);
    } else if (/chất liệu|vật liệu/.test(label)) {
      if (specs.materials.length === 0) specs.materials = parseMaterials(value);
    } else if (/khung|thân|đũa|trục/.test(label)) {
      // The frame and the shaft, each named with its own lay-up or construction:
      // "Khung vợt: 6.8mm Slim Tube + Narrow Fluid Frame", "Khung: Blade Frame
      // Gen 2", "Đũa vợt: 6840 HPT", "Cấu trúc khung: Compact Box Frame". That is
      // the same kind of fact as "Chất liệu", so it lands in the same column —
      // and where the value is a Vietnamese description of the shape rather than
      // a material ("Khung vợt dạng hộp") `parseMaterials` drops it.
      for (const material of parseMaterials(value)) {
        if (!specs.materials.includes(material)) specs.materials.push(material);
      }
    } else if (/cán|chuôi|tay cầm/.test(label)) {
      const grip = /G([456])/i.exec(value);
      if (grip) specs.gripSize ??= `G${grip[1]}` as GripSize;
    } else if (/độ dài|chiều dài/.test(label)) {
      const mm = /(\d{3})\s*mm/i.exec(value);
      if (mm) specs.lengthMm ??= parseInt(mm[1], 10);
    } else if (IGNORED_LABELS.test(label)) {
      // Read and dropped deliberately. See IGNORED_LABELS.
    } else if (label.length <= 28 && value.length <= 48) {
      specs.unparsed.push(`${row[1]}: ${value}`);
    }
  }

  // A grade is the shop's own answer and always wins; a listing that published
  // only grams gets the band those grams fall in, which is the same reading
  // `generate-sql.ts` makes of every scraped racket.
  if (!specs.weightClass && specs.weightGrams !== null) {
    specs.weightClass = weightClassOf(specs.weightGrams);
  }

  return specs;
}
