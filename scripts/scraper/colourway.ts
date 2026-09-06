/**
 * Colourway extraction.
 *
 * Retailers title the same racket once per colour — "Astrox Tour 8500 đỏ",
 * "Astrox Tour 8500 xanh", "Astrox Tour 8500 cam" — and per weight, so a single
 * model arrives as a handful of listings. Treating each as its own racket
 * splits the spec page, the Court Score and the price history three ways for
 * what is one frame, which is exactly what a comparison site must not do.
 *
 * So the colour comes off the model name and becomes what the schema already
 * calls it: a property of the variant.
 *
 * The hard part is knowing where a colour ends and a model designation begins.
 * `Thruster Ryuga CLS C`, `CLS J` and `CLS I` are three different rackets, not
 * three colours of one, and `Kimetsu no Yaiba 40 - Kamado Nezuko` is an edition,
 * not a shade. The rule here is deliberately narrow: only strip tokens from the
 * *end* of the name, only while every token is a known colour word, and never
 * strip so far that the remaining name loses its model identifier. Anything
 * unrecognised stops the walk and stays part of the model.
 */

/** Colour heads. Vietnamese first, since that is what these shops write in. */
const COLOUR_WORDS = new Set([
  // Vietnamese
  "đen", "den",
  "trắng", "trang",
  "xanh",
  "đỏ", "do",
  "vàng", "vang",
  "hồng", "hong",
  "tím", "tim",
  "cam",
  "xám", "xam",
  "bạc", "bac",
  "nâu", "nau",
  "ghi",
  "kem",
  "bẻ", "be",
  "lam",
  "lục", "luc",
  "chàm", "cham",

  // English, as printed on these listings
  "black", "white", "blue", "red", "yellow", "pink", "purple", "orange",
  "grey", "gray", "silver", "gold", "navy", "green", "charcoal", "violet",
  "cyan", "beige", "ivory", "bronze", "copper", "teal", "lime", "coral",
  // feletsports.com sells the Neo 722 in four colours and writes one of them
  // "PURPLE/ROSE RED". Without `rose` the run stops there and the page reads as
  // a model called "Neo 722 Purple/Rose".
  "rose",
]);

/**
 * Qualifiers that only ever follow a colour ("xanh lá", "xám đậm"). They are
 * not colours on their own, so they can never start a colour run — that keeps
 * a stray "đậm" from eating into a model name.
 */
const COLOUR_MODIFIERS = new Set([
  "dương", "duong",   // xanh dương — blue
  "lá", "la",         // xanh lá — green
  "lục", "luc",
  "biển", "bien",     // xanh biển — sea blue
  "chuối", "chuoi",   // xanh chuối — banana green
  "ngọc", "ngoc",     // xanh ngọc — jade
  "rêu", "reu",       // xanh rêu — moss
  "than",             // xanh than / tím than — charcoal blue
  "navy",
  "đậm", "dam",       // dark
  "nhạt", "nhat",     // light
  "sáng", "sang",
  "tối", "toi",
  "phấn", "phan",     // hồng phấn — powder pink
  "đô", "do",         // đỏ đô — burgundy
  "chanh",            // vàng chanh — lemon
  "đồng", "dong",     // vàng đồng — bronze
  "cốm", "com",
  "mint",
  "light", "dark", "neon", "matte",
  // "AERO CARBON SNOW WHITE" is the fifth colourway of the Aero Carbon, on a
  // page of its own. A modifier rather than a head, so a lone "Snow" can never
  // start a run and eat a model name.
  "snow",
]);

/** Separators that can sit between two colours without ending the run. */
const COLOUR_CONNECTORS = new Set(["-", "–", "—", "/", "&", "+", ",", "và", "va"]);

/** Strip diacritics so "Đỏ" and "do" hit the same entry. */
function fold(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

const FOLDED_COLOURS = new Set([...COLOUR_WORDS].map(fold));
const FOLDED_MODIFIERS = new Set([...COLOUR_MODIFIERS].map(fold));

function isColourHead(token: string): boolean {
  return FOLDED_COLOURS.has(fold(token));
}

function isColourPart(token: string): boolean {
  const folded = fold(token);
  return FOLDED_COLOURS.has(folded) || FOLDED_MODIFIERS.has(folded);
}

function isConnector(token: string): boolean {
  return COLOUR_CONNECTORS.has(token.toLowerCase()) || /^[-–—/&+,]+$/.test(token);
}

/**
 * A model identifier: something with a digit, or a short all-caps code like
 * "CLS" or "XS". If stripping colours would leave nothing of this kind, the
 * "colour" was really part of the model and we back out.
 */
function looksLikeModelIdentifier(tokens: string[]): boolean {
  return tokens.some((t) => /\d/.test(t) || /^[A-Z]{2,}$/.test(t) || t.length >= 4);
}

export interface ColourSplit {
  /** The model name with the colour removed. */
  base: string;
  /** The colour as written on the listing, or null when there was none. */
  colourway: string | null;
}

interface Token {
  text: string;
  start: number;
}

/**
 * Tokenise on whitespace *and* on separators inside a token, so that
 * "Charcoal/Black" and "xanh lục/xám đậm" are seen as colour runs rather than
 * as one unrecognised word. Offsets are kept so the result can be sliced out of
 * the original string with its spelling and spacing intact.
 */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[^\s\-–—/&+,]+|[-–—/&+,]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index });
  }
  return tokens;
}

/**
 * Split a model name into its base and its colourway.
 *
 * Only a trailing run of colour words is taken, and only when what remains
 * still identifies a model.
 */
export function splitColourway(modelName: string): ColourSplit {
  const raw = modelName.trim();
  if (!raw) return { base: raw, colourway: null };

  const tokens = tokenise(raw);
  if (tokens.length === 0) return { base: raw, colourway: null };

  let cut = tokens.length;
  let sawColourHead = false;

  // Walk backwards while the tail is still colour.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i].text;

    if (isColourPart(token)) {
      if (isColourHead(token)) sawColourHead = true;
      cut = i;
      continue;
    }

    // A connector only continues the run once something colour-ish has already
    // been seen to its right, e.g. the dash in "XS - Đen đỏ".
    if (isConnector(token) && cut < tokens.length) {
      cut = i;
      continue;
    }

    break;
  }

  // No colour at all, or the tail was only modifiers and connectors with no
  // actual colour — "Pro +" must not be read as a colourway.
  if (cut === tokens.length || !sawColourHead) {
    return { base: raw, colourway: null };
  }

  // Slice the original string rather than rejoining tokens, so "Charcoal/Black"
  // comes back as written instead of "Charcoal / Black".
  const base = raw.slice(0, tokens[cut].start).replace(/[\s\-–—/&+,]+$/, "").trim();
  const colourway = raw.slice(tokens[cut].start).replace(/^[\s\-–—/&+,]+/, "").trim();

  // The whole name was a colour, or what remains no longer names a model — in
  // either case the colour was load-bearing, so leave the name alone.
  const baseTokens = tokenise(base).map((t) => t.text);
  if (baseTokens.length === 0 || !looksLikeModelIdentifier(baseTokens)) {
    return { base: raw, colourway: null };
  }

  return { base, colourway: colourway || null };
}

/**
 * Remove weight-class and grip tokens from a model name. "Nitrix 80 Bullet 4U"
 * and "Nitrix 80 Bullet" are one racket; the 4U is already captured as the
 * variant's weight class and repeating it in the model name splits the two.
 */
export function stripVariantTokens(modelName: string): string {
  return modelName
    .replace(/(?:^|\s)[2345]U(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)G[456](?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the name to display for a racket that arrived under several spellings
 * ("THRUSTER RYUGA CLS", "Thruster Ryuga CLS", "thruster ryuga cls").
 *
 * Majority wins; ties go to the best-cased candidate, because shouting a model
 * name is a retailer habit rather than how the model is written.
 */
export function canonicalName(names: string[]): string {
  if (names.length === 0) return "";

  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

  const score = (name: string): number => {
    const letters = name.replace(/[^A-Za-zÀ-ỹ]/g, "");
    if (letters.length === 0) return 0;
    const upper = (name.match(/[A-ZÀ-Ỹ]/g) ?? []).length / letters.length;
    // Mixed case scores best; ALL CAPS and all-lower score worst.
    if (upper > 0.8) return 0;
    if (upper < 0.05) return 1;
    return 2;
  };

  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const s = score(b[0]) - score(a[0]);
    if (s !== 0) return s;
    return a[0].length - b[0].length;
  })[0][0];
}
