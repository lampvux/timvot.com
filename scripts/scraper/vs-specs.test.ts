/**
 * The VS specification block, as venson.vn and vssports.vn publish it.
 *
 * Every line in these fixtures is a real one, copied from a live listing on one
 * of the two shops. That matters here more than anywhere else in the scraper:
 * this module is almost entirely a vocabulary of Vietnamese labels, and a rule
 * that reads an invented label correctly has proved nothing. Where a case looks
 * odd — a tension quoted under the weight label, a 68-gram frame — the shop
 * really does publish it that way, and the comment says which one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBalanceMm,
  parseMaterials,
  parseShaftDiameterMm,
  parseSpecs,
  parseTension,
  parseWeight,
} from "./vs-specs";

/** The shops write the block as list items; the parser reads tags as breaks. */
function block(...lines: string[]): string {
  return lines.map((line) => `<li><span>${line}</span></li>`).join("");
}

/* --------------------------------------------------------------- one field */

test("a weight is a grade, a gram figure, or both", () => {
  assert.deepEqual(parseWeight("4U (82 ± 2g)"), { weightClass: "4U", grams: 82 });
  assert.deepEqual(parseWeight("87±2 g"), { weightClass: null, grams: 87 });
  assert.deepEqual(parseWeight("5U (77 ± 2 g)"), { weightClass: "5U", grams: 77 });
  assert.deepEqual(parseWeight("4U"), { weightClass: "4U", grams: null });

  // 6U is a real VS grade and the schema's enum stops at 5U, so a lighter frame
  // lands in the lightest band there is rather than inventing one.
  assert.equal(parseWeight("6U (72 ± 2g)").weightClass, "5U");

  // Windsoul Fengling on venson.vn files its string tension under the weight
  // label. 22 is not a mass a racket can have, so nothing is read — which is
  // what keeps the shop's mislabelling out of the column.
  assert.deepEqual(parseWeight("22-30 lbs"), { weightClass: null, grams: null });
});

test("a balance point is the centre of whatever the shop quoted", () => {
  assert.equal(parseBalanceMm("295±3 mm"), 295);
  assert.equal(parseBalanceMm("305 - 310 mm"), 308);
  assert.equal(parseBalanceMm("Khoảng 292mm"), 292);
  // Outside what a badminton frame's balance can be: refused, not clamped.
  assert.equal(parseBalanceMm("Nặng đầu"), null);
  assert.equal(parseBalanceMm("1000 mm"), null);
});

test("pounds win over kilos, and a single figure opens a six-pound window", () => {
  assert.deepEqual(parseTension("24 – 28 Lbs"), [24, 28]);
  assert.deepEqual(parseTension("22–30 lbs"), [22, 30]);
  // Both units on one line: the pounds are the shop's own figure, the kilos are
  // its rounding of them.
  assert.deepEqual(parseTension("22 – 30 lbs (~13,6 kg)"), [22, 30]);
  assert.deepEqual(parseTension("30 lbs"), [24, 30]);
  // Kilos alone are converted.
  assert.deepEqual(parseTension("13,5 kg"), [24, 30]);
  assert.equal(parseTension("Tùy chỉnh"), null);
});

test("a shaft diameter is read only where it is one", () => {
  assert.equal(parseShaftDiameterMm("6.2 mm (siêu mỏng)"), 6.2);
  assert.equal(parseShaftDiameterMm("6,5 mm Nano Carbon siêu mỏng"), 6.5);
  // The frame length in the same shape, and outside what a shaft can be.
  assert.equal(parseShaftDiameterMm("675 mm"), null);
});

test("a material line keeps the lay-up and drops the prose around it", () => {
  assert.deepEqual(parseMaterials("Hot-Melt Carbon – HM Carbon"), ["Hot-Melt Carbon – HM Carbon"]);
  assert.deepEqual(parseMaterials("30T Mitsubishi Carbon Sheet + Compact Box Frame"), [
    "30T Mitsubishi Carbon Sheet",
    "Compact Box Frame",
  ]);
  // A Vietnamese description of a material is not a material name.
  assert.deepEqual(parseMaterials("Carbon nóng chảy mật độ cao nhiều lớp"), []);
  assert.deepEqual(parseMaterials("Khung hộp phá gió, độ đàn hồi cao"), []);

  // A parenthesised gloss with a comma in it is cut in half by the segment
  // split, and half a bracket is not a material name. The name survives.
  assert.deepEqual(
    parseMaterials("MHE Carbon (Multi Layer High Elasticity Carbon, hệ số đàn hồi cao)"),
    ["MHE Carbon"],
  );
  // One that survives the split whole is left whole.
  assert.deepEqual(parseMaterials("MHR CARBON (Multi Layer High Rigidity Carbon)"), [
    "MHR CARBON (Multi Layer High Rigidity Carbon)",
  ]);
});

/* ------------------------------------------------------------- whole blocks */

test("a vssports.vn block reads end to end", () => {
  // vssports.vn/vot-cau-long-vs-blade-9200.html, verbatim.
  const specs = parseSpecs(
    block(
      "Trọng lượng: 87±2 g",
      "Điểm cân bằng: 295±3 mm",
      "Độ cứng thân: Trung bình",
      "Độ căng khuyến nghị: 22–30 lbs",
      "Chiều dài: 675 mm",
      "Tay cầm: G6",
      "Chất liệu: Hot-Melt Carbon – HM Carbon",
      "Khung: Blade Frame Gen 2",
      "Lối chơi: Kiểm soát + Tấn công",
    ),
  );

  // 87 g publishes no grade, so the band comes from the grams.
  assert.equal(specs.weightClass, "3U");
  assert.equal(specs.weightGrams, 87);
  assert.equal(specs.balancePointMm, 295);
  assert.equal(specs.shaftFlex, "medium");
  assert.deepEqual(specs.tensionLbs, [22, 30]);
  assert.equal(specs.lengthMm, 675);
  assert.equal(specs.gripSize, "G6");
  // "Khung" is a bare label on this shop and names the frame's construction,
  // which is the same kind of fact as "Chất liệu" and lands in the same column.
  assert.deepEqual(specs.materials, ["Hot-Melt Carbon – HM Carbon", "Blade Frame Gen 2"]);
  // "Lối chơi" is editorial about how the frame plays. Read, and deliberately
  // not turned into play_style_tags.
  assert.deepEqual(specs.unparsed, []);
});

test("a venson.vn block reads end to end", () => {
  // venson.vn, the shape its descriptions use.
  const specs = parseSpecs(
    block(
      "– Trọng lượng : 4U (82 ± 2g)",
      "– Điểm cân bằng : 300 ± 3mm",
      "– Mức căng : 24 – 28 Lbs",
      "– Độ cứng : Cứng",
      "– Chất liệu : Japan Ultra High Modulus Carbon Graphite",
      "– Chu vi cán cầm : G5",
      "– Độ dài : 675 mm",
      "– Số lỗ gen : 72",
    ),
  );

  assert.equal(specs.weightClass, "4U");
  assert.equal(specs.weightGrams, 82);
  assert.equal(specs.balancePointMm, 300);
  assert.deepEqual(specs.tensionLbs, [24, 28]);
  assert.equal(specs.shaftFlex, "stiff");
  assert.deepEqual(specs.materials, ["Japan Ultra High Modulus Carbon Graphite"]);
  assert.equal(specs.gripSize, "G5");
  assert.equal(specs.lengthMm, 675);
  assert.equal(specs.holes, 72);
});

test("the label is matched on the phrase that identifies it, not on the whole", () => {
  // vssports.vn writes the product name into half its labels.
  const specs = parseSpecs(
    block(
      "Trọng lượng Vợt cầu lông VS Youlong Moyin: 5U (77 ± 2 g)",
      "Tay cầm Vợt cầu lông VS HC 898 II: G6",
      "Chiều dài vợt cầu lông VS Ultra Woven 88S: 675 mm",
      "Độ cứng vợt cầu lông VS Fire Demon: Trung bình (giữa cứng và dẻo)",
    ),
  );

  assert.equal(specs.weightClass, "5U");
  assert.equal(specs.weightGrams, 77);
  assert.equal(specs.gripSize, "G6");
  assert.equal(specs.lengthMm, 675);
  assert.equal(specs.shaftFlex, "medium");
});

test("balance is read before tension, one diacritic apart", () => {
  // "độ cân bằng" and "độ căng" differ by an ă. Testing tension first would
  // read the balance line as a tension and throw the balance away.
  const specs = parseSpecs(block("Độ cân bằng: 300 ± 3 mm", "Độ căng dây tối đa: 24 – 32 lbs"));
  assert.equal(specs.balancePointMm, 300);
  assert.deepEqual(specs.tensionLbs, [24, 32]);
});

test("a label nobody has taught it yet is reported rather than guessed at", () => {
  const specs = parseSpecs(
    block(
      // Not a spec: the shop's editorial, and on the ignore list.
      "Thương hiệu: VS",
      "Màu sắc: Trắng/Cam",
      "Swing weight: 84 kg/cm²",
      "Phân loại lối đánh: Tấn công nhanh",
      // A real spec line in a spelling this module does not know.
      "Cấu trúc tạo hình: Đúc hai lần (Double Molding)",
      // A paragraph that happens to contain a colon is not a label.
      "Lưu ý: vợt cầu lông VS được bảo hành chính hãng trong vòng ba tháng kể từ ngày mua tại cửa hàng",
    ),
  );

  assert.deepEqual(specs.unparsed, ["Cấu trúc tạo hình: Đúc hai lần (Double Molding)"]);
});
