import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { routing } from "./routing";

/**
 * The two message files have to describe the same app.
 *
 * `vi` is the default and `en` is available, and next-intl resolves a message
 * at render time in whichever locale the URL asks for. A key that exists in
 * one file and not the other is therefore a page that works in one language
 * and shows a raw key in the other — and nothing in the build says so, because
 * neither file is type-checked against the other.
 *
 * The placeholder half of this is the sharper one. `t("minReviews", { count })`
 * against a message that spells the number instead of interpolating it is not
 * an error at all: the argument is ignored and the page publishes a stale
 * value. That is exactly how /methodology came to promise five reviews from a
 * constant it was no longer reading.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(here, "..", "..", "messages");

type Messages = Record<string, unknown>;

const load = (locale: string): Messages =>
  JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf8"));

/** Every leaf key, dot-joined. */
function keysOf(node: unknown, path = "", out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(path);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) {
    keysOf(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

function valueAt(messages: Messages, path: string): string | undefined {
  let node: unknown = messages;
  for (const segment of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * ICU argument names in a message.
 *
 * Simple `{name}`, plus the leading name of a `{count, plural, …}` or
 * `{when, date, …}` form. Nested sub-messages inside a plural are not walked:
 * the argument that matters for parity is the one the call site passes.
 */
function placeholdersOf(message: string): Set<string> {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) {
    names.add(match[1]);
  }
  return names;
}

/** Tags like `<strong>…</strong>` that next-intl resolves through `t.rich`. */
function tagsOf(message: string): Set<string> {
  const tags = new Set<string>();
  for (const match of message.matchAll(/<\s*([A-Za-z][A-Za-z0-9]*)\s*>/g)) {
    tags.add(match[1]);
  }
  return tags;
}

const LOCALES = [...routing.locales];
const byLocale = new Map(LOCALES.map((locale) => [locale, load(locale)]));

test("the locales under test are the ones the app routes", () => {
  // If a third locale is added and this file is not, its message file is never
  // checked against anything.
  assert.deepEqual(LOCALES.sort(), ["en", "vi"]);
  assert.equal(routing.defaultLocale, "vi");
});

test("every locale has exactly the same set of keys", () => {
  const reference = routing.defaultLocale;
  const referenceKeys = new Set(keysOf(byLocale.get(reference)));

  for (const locale of LOCALES) {
    if (locale === reference) continue;
    const keys = new Set(keysOf(byLocale.get(locale)));

    const missing = [...referenceKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !referenceKeys.has(key));

    assert.deepEqual(
      missing,
      [],
      `messages/${locale}.json is missing ${missing.length} key(s) that ` +
        `${reference} has: ${missing.slice(0, 10).join(", ")}. Every one is a ` +
        `page that renders the raw key in ${locale}.`,
    );
    assert.deepEqual(
      extra,
      [],
      `messages/${locale}.json has ${extra.length} key(s) ${reference} does ` +
        `not: ${extra.slice(0, 10).join(", ")}.`,
    );
  }
});

test("a message takes the same arguments in every locale", () => {
  const reference = routing.defaultLocale;
  const referenceMessages = byLocale.get(reference)!;

  for (const key of keysOf(referenceMessages)) {
    const expected = placeholdersOf(valueAt(referenceMessages, key) ?? "");

    for (const locale of LOCALES) {
      if (locale === reference) continue;
      const translated = valueAt(byLocale.get(locale)!, key);
      if (translated === undefined) continue; // reported by the test above.

      const actual = placeholdersOf(translated);

      const missing = [...expected].filter((name) => !actual.has(name));
      const unknown = [...actual].filter((name) => !expected.has(name));

      assert.deepEqual(
        missing,
        [],
        `messages/${locale}.json "${key}" drops {${missing.join("}, {")}}. ` +
          `The call site still passes it, so the value is silently discarded ` +
          `and the sentence publishes whatever was typed in its place.`,
      );
      assert.deepEqual(
        unknown,
        [],
        `messages/${locale}.json "${key}" uses {${unknown.join("}, {")}}, ` +
          `which ${reference} does not — next-intl throws at render time for ` +
          `an argument the caller never passes.`,
      );
    }
  }
});

test("a rich message uses the same tags in every locale", () => {
  const reference = routing.defaultLocale;
  const referenceMessages = byLocale.get(reference)!;

  for (const key of keysOf(referenceMessages)) {
    const expected = tagsOf(valueAt(referenceMessages, key) ?? "");
    if (expected.size === 0) continue;

    for (const locale of LOCALES) {
      if (locale === reference) continue;
      const translated = valueAt(byLocale.get(locale)!, key);
      if (translated === undefined) continue;

      assert.deepEqual(
        [...tagsOf(translated)].sort(),
        [...expected].sort(),
        `messages/${locale}.json "${key}" does not carry the same tags as ` +
          `${reference}. t.rich throws when a tag it was given no renderer ` +
          `for appears, and renders nothing when one it expected is absent.`,
      );
    }
  }
});

test("no message is empty in any locale", () => {
  for (const locale of LOCALES) {
    const messages = byLocale.get(locale)!;
    const blank = keysOf(messages).filter((key) => !(valueAt(messages, key) ?? "").trim());

    assert.deepEqual(
      blank,
      [],
      `messages/${locale}.json leaves ${blank.slice(0, 10).join(", ")} blank.`,
    );
  }
});

test("no message is left untranslated by being identical", () => {
  // Not a hard rule — a model name or a spec code is the same in both — so
  // this only looks at sentences. A whole paragraph identical in vi and en is
  // a paste, not a translation.
  const en = byLocale.get("en")!;
  const vi = byLocale.get("vi")!;

  const suspicious = keysOf(vi).filter((key) => {
    const a = valueAt(vi, key) ?? "";
    const b = valueAt(en, key) ?? "";
    if (a !== b) return false;
    // Long enough to be prose, and containing a space, so "4U" and "G5" and
    // "Yonex" do not trip it.
    return a.length > 40 && a.includes(" ");
  });

  assert.deepEqual(
    suspicious,
    [],
    `${suspicious.slice(0, 6).join(", ")} is the same sentence in both ` +
      `locales. Vietnamese is the default language of this product; an ` +
      `English paragraph in vi.json is a missing translation, not a choice.`,
  );
});

test("model names and spec codes are never translated", () => {
  // The enums namespace holds the words that *are* translated. These are the
  // ones that must not be: a spec code is what is printed on the racket.
  const en = byLocale.get("en")!;
  const vi = byLocale.get("vi")!;

  for (const key of keysOf(vi)) {
    const value = valueAt(vi, key) ?? "";
    // Weight classes and grip sizes, as they appear in copy.
    for (const code of ["2U", "3U", "4U", "5U", "G4", "G5", "G6"]) {
      if (!value.includes(code)) continue;
      assert.ok(
        (valueAt(en, key) ?? "").includes(code),
        `messages/vi.json "${key}" writes the spec code ${code} but the ` +
          `English does not, so one of the two has translated it.`,
      );
    }
  }
});
