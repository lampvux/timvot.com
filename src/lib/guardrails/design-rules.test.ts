import assert from "node:assert/strict";
import test from "node:test";
import { formatDelta, formatDong, stockTone } from "@/lib/format";
import { BALANCE_MAX_MM, BALANCE_MIN_MM } from "@/lib/types";
import {
  functionBody,
  list,
  read,
  readRoot,
  sourceFiles,
  stripComments,
  stripCommentsAndStrings,
} from "./source";

/**
 * The design rules, enforced rather than reviewed.
 *
 * Every one of these is written down in CLAUDE.md and none of them was
 * checkable before this file existed: no emoji, no exclamation marks, prices
 * never abbreviated, stock language that never invents scarcity, one fixed
 * balance rule, and no radar chart anywhere. They are small rules, which is
 * exactly why they erode — each individual violation looks harmless in a diff.
 */

const LOCALES = ["en", "vi"] as const;

interface Entry {
  key: string;
  value: string;
}

function messageEntries(locale: string): Entry[] {
  const messages = JSON.parse(readRoot("messages", `${locale}.json`));
  const out: Entry[] = [];

  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      out.push({ key: path, value: node });
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key);
    }
  };

  walk(messages, "");
  return out;
}

/* -------------------------------------------------------- tone of the copy */

/** Pictographs, dingbats, and the variation selector that makes one of them
 *  render in colour. Kept off the design on purpose: the product's voice is a
 *  knowledgeable shop owner, not a notification. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

test("no message carries an emoji", () => {
  for (const locale of LOCALES) {
    const offenders = messageEntries(locale)
      .filter((entry) => EMOJI.test(entry.value))
      .map((entry) => entry.key);

    assert.deepEqual(
      offenders,
      [],
      `messages/${locale}.json: ${list(offenders)} contains an emoji.`,
    );
  }
});

test("no message carries an exclamation mark", () => {
  for (const locale of LOCALES) {
    const offenders = messageEntries(locale)
      .filter((entry) => entry.value.includes("!"))
      .map((entry) => entry.key);

    assert.deepEqual(
      offenders,
      [],
      `messages/${locale}.json: ${list(offenders)} uses an exclamation mark. ` +
        `Sentence case, no exclamation marks — the tone is a shop owner who ` +
        `knows the answer, not an advertisement.`,
    );
  }
});

test("no rendered string in a component carries an emoji", () => {
  // Copy sometimes lands in a component rather than a message file — an empty
  // state, an aria-label. The rule does not care which file it is in.
  //
  // Comments are stripped but string literals are kept: an emoji in an
  // `aria-label` is still rendered, while the home page's commented-out ticker
  // bar is not. A rule that fails on dead code teaches people to delete it.
  const offenders = sourceFiles()
    .filter((file) => EMOJI.test(stripComments(file.text)))
    .map((file) => file.path);

  assert.deepEqual(offenders, [], `${list(offenders)} contains an emoji.`);
});

/* ------------------------------------------------------------------ prices */

test("prices are never abbreviated", () => {
  // ₫3.3M is the exact thing the product exists to stop doing. Approximation
  // is what makes two listings look like the same price when they are not.
  const abbreviation = /₫\s*\d+([.,]\d+)?\s*(M|m|K|k|tr|Tr|TR)\b/;

  for (const locale of LOCALES) {
    const offenders = messageEntries(locale)
      .filter((entry) => abbreviation.test(entry.value))
      .map((entry) => entry.key);

    assert.deepEqual(
      offenders,
      [],
      `messages/${locale}.json: ${list(offenders)} abbreviates a price.`,
    );
  }

  const inCode = sourceFiles()
    .filter((file) => abbreviation.test(file.text))
    .map((file) => file.path);

  assert.deepEqual(inCode, [], `${list(inCode)} abbreviates a price.`);
});

test("formatDong writes the house style in full", () => {
  assert.equal(formatDong(3_290_000), "₫3.290.000");
  assert.equal(formatDong(0), "₫0");
  assert.equal(formatDong(999), "₫999");
  assert.equal(formatDong(1_000), "₫1.000");

  // Full stops, never commas: the Vietnamese convention, and the one the
  // design system specifies.
  assert.ok(!formatDong(1_234_567).includes(","));
});

test("a delta carries a sign, and its minus is U+2212", () => {
  assert.equal(formatDelta(-120_000), "−₫120.000");
  assert.equal(formatDelta(120_000), "+₫120.000");
  assert.equal(formatDelta(0), "₫0");

  // A hyphen-minus is a different character and renders visibly shorter beside
  // the plus it has to align with in a table.
  assert.ok(!formatDelta(-1).includes("-"), "formatDelta used a hyphen.");
  assert.ok(formatDong(-1).includes("−"), "formatDong used a hyphen.");
});

/* ------------------------------------------------------------------- stock */

test("stock language never invents scarcity", () => {
  // Exact count to 10, then "10+"; below 4 it goes amber. The tone boundary is
  // the product claim — a shop with four in stock is not "almost gone".
  assert.equal(stockTone(0), "out");
  assert.equal(stockTone(-1), "out");
  assert.equal(stockTone(1), "low");
  assert.equal(stockTone(3), "low");
  assert.equal(stockTone(4), "normal");
  assert.equal(stockTone(10), "normal");
  assert.equal(stockTone(999), "normal");
});

test("the stock ceiling is written once", () => {
  const ds = read("components", "ds", "data.tsx");
  const code = stripCommentsAndStrings(ds);

  // "10+" above ten. If a second threshold appears somewhere else, the two
  // will disagree the first time either moves.
  assert.ok(
    /10\s*\+|"10\+"|`10\+`|> 10|>= 10/.test(ds),
    `components/ds/data.tsx no longer caps the stock count at 10. Exact to ` +
      `10, then "10+" — never a raw 347.`,
  );
  assert.ok(code.length > 0);
});

/* --------------------------------------------------------- the one ruler */

test("the balance rule is fixed at 280–305 mm", () => {
  assert.equal(BALANCE_MIN_MM, 280);
  assert.equal(BALANCE_MAX_MM, 305);

  const data = read("components", "ds", "data.tsx");
  assert.ok(
    data.includes("BALANCE_MIN_MM") && data.includes("BALANCE_MAX_MM"),
    `the Balance Ruler in components/ds/data.tsx no longer reads the ` +
      `constants from types.ts. Every racket is plotted on the same fixed ` +
      `rule — a ruler that rescales to its own data makes two rackets look ` +
      `equally extreme when one of them is not.`,
  );
});

test("the balance ruler never rescales to its own data", () => {
  // The failure this catches: a ruler that fits itself to the two rackets being
  // compared, so the markers spread to the full width whatever the real
  // difference is, and 288 mm beside 290 mm looks like an opposite.
  //
  // Scoped to the ruler's own body on purpose. `PriceHistory` lives in the same
  // file and *must* autoscale — a price series has no fixed rule to plot on.
  const data = read("components", "ds", "data.tsx");
  const ruler = functionBody(data, "BalanceRuler");

  assert.ok(ruler, "BalanceRuler is no longer a named function in ds/data.tsx.");

  // A spread min/max is only a rescale if it is taken over the *millimetres*.
  // The ruler legitimately takes one over `.row` to stagger labels that would
  // otherwise collide — that is vertical layout, not the scale.
  const spreads = [
    ...stripCommentsAndStrings(ruler).matchAll(/Math\.(?:min|max)\(\s*\.\.\.([^)]*)\)/g),
  ].map((m) => m[1]);

  const overMillimetres = spreads.filter((argument) => /\bmm\b/.test(argument));

  assert.deepEqual(
    overMillimetres,
    [],
    `BalanceRuler takes a min or max across its markers' millimetres, which ` +
      `fits the rule to whatever it is given. Every racket is plotted on the ` +
      `same fixed ${BALANCE_MIN_MM}–${BALANCE_MAX_MM} mm rule, and in ` +
      `comparison all markers share one rule: 288 mm beside 290 mm has to ` +
      `look like two millimetres, not like an opposite.`,
  );

  // Horizontal position comes from the shared helper, which clamps to the
  // constants. A hand-rolled percentage is how a second scale gets in.
  assert.ok(
    /left:\s*balancePercent\(/.test(ruler),
    "BalanceRuler stopped positioning its markers with balancePercent().",
  );
});

/* ----------------------------------------------------- the absent chart */

test("there is no radar chart anywhere", () => {
  // Deliberately absent from the design system. A radar chart implies the four
  // axes are commensurable and that area means something; neither is true.
  const offenders = sourceFiles()
    .filter((file) => /\bradar\b/i.test(stripCommentsAndStrings(file.text)))
    .map((file) => file.path);

  assert.deepEqual(
    offenders,
    [],
    `${list(offenders)} mentions a radar chart. There is no radar chart ` +
      `anywhere, deliberately.`,
  );
});

test("no charting library has been added", () => {
  const pkg = JSON.parse(readRoot("package.json"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  const charting = deps.filter((name) =>
    /^(recharts|chart\.js|victory|nivo|@nivo|apexcharts|echarts|plotly)/.test(name),
  );

  assert.deepEqual(
    charting,
    [],
    `${list(charting)} was added as a dependency. The price sparkline and the ` +
      `Balance Ruler are hand-drawn SVG on purpose — a charting library is ` +
      `both a bundle cost and a house-style cost.`,
  );
});

/* ----------------------------------------------------------- empty states */

test("every empty state says what to do next", () => {
  // "No results" is not an empty state. The rule is a next action with a
  // number in it, so the visitor knows how far off they are.
  for (const locale of LOCALES) {
    const empties = messageEntries(locale).filter((entry) =>
      /\.empty$|\.emptyBody$|noResults(Body)?$/.test(entry.key),
    );

    assert.ok(
      empties.length > 0,
      `messages/${locale}.json has no empty-state copy at all, which means ` +
        `this rule stopped being checked rather than started being followed.`,
    );

    const bare = empties
      .filter((entry) => entry.value.trim().length < 25 && !/\{/.test(entry.value))
      .map((entry) => entry.key);

    assert.deepEqual(
      bare,
      [],
      `messages/${locale}.json: ${list(bare)} is a bare empty state. Say what ` +
        `to do next, with a number.`,
    );
  }
});
