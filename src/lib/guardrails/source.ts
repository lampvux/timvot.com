import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

/**
 * Shared plumbing for the guardrail suite.
 *
 * Every test in this directory asserts on source text rather than on
 * behaviour, for the reason `read-path.test.ts` gives: the regressions these
 * catch — a snapshot read on a hot path, an icon barrel import, a `cookies()`
 * in the root layout — are visible in an import list long before they are
 * visible in a timing or a screenshot, and checking the import list costs
 * milliseconds and needs no database, no build and no browser.
 *
 * These are not a substitute for the behavioural suites. They are the cheapest
 * place to enforce a rule that is otherwise only prose in CLAUDE.md, and prose
 * does not fail a pull request.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** `src/`, whatever the caller's depth. */
export const SRC = join(here, "..", "..");

/** The repository root. */
export const ROOT = join(SRC, "..");

export const read = (...parts: string[]): string =>
  readFileSync(join(SRC, ...parts), "utf8");

export const readRoot = (...parts: string[]): string =>
  readFileSync(join(ROOT, ...parts), "utf8");

export interface SourceFile {
  /** Repo-relative, always with forward slashes, so a failure message is
   *  clickable on every platform. */
  path: string;
  absolute: string;
  text: string;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "guardrails"]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      walk(absolute, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(absolute);
    }
  }
  return out;
}

/**
 * Every `.ts`/`.tsx` file under `src/`, excluding this directory.
 *
 * Test files are kept in on purpose: a rule that the app must follow and the
 * tests may break is a rule with a hole in it. Where a suite genuinely needs
 * an exception it filters explicitly, so the exception is visible.
 */
export function sourceFiles(subdir = ""): SourceFile[] {
  const base = subdir ? join(SRC, subdir) : SRC;
  return walk(base, []).map((absolute) => ({
    path: relative(ROOT, absolute).split(sep).join("/"),
    absolute,
    text: readFileSync(absolute, "utf8"),
  }));
}

/** Files carrying the `"use client"` directive. */
export function clientFiles(): SourceFile[] {
  return sourceFiles().filter((file) => /^\s*["']use client["']/m.test(file.text));
}

/**
 * Strip comments and string literals before pattern-matching.
 *
 * Without this, every rule below is defeated or falsely tripped by a doc
 * comment that names the thing it forbids — and these files are heavily
 * commented by design. Crude but sufficient: it is only ever used to decide
 * whether an identifier appears in live code.
 */
export function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

/** Just the comments, for the rules that are about published prose. */
export function commentsOf(text: string): string {
  return [
    ...(text.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(text.match(/(?:^|[^:])\/\/[^\n]*/g) ?? []),
  ].join("\n");
}

/** The named bindings of every `import { … } from "<module>"` in a file. */
export function namedImportsFrom(text: string, module: string): string[] | null {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
  );
  const match = text.match(pattern);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((name) => name.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

/** Every module specifier a file imports from. */
export function importedModules(text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** A readable list for an assertion message. */
export const list = (items: string[], limit = 8): string =>
  items.slice(0, limit).join(", ") +
  (items.length > limit ? ` (+${items.length - limit} more)` : "");

/**
 * The full method chain starting at an index, e.g. everything from
 * `.from("offers")` through the final `.range(from, to)`.
 *
 * Walks the real bracket structure rather than matching a line, because these
 * chains are written across five or six lines and a line-based rule would read
 * `.order("id")` as belonging to whichever statement happened to sit above it.
 */
export function chainFrom(text: string, start: number): string {
  let i = start;
  let depth = 0;
  const end = text.length;

  while (i < end) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) {
        // End of one call. Continue only if another `.method` follows.
        let j = i + 1;
        while (j < end && /\s/.test(text[j])) j++;
        if (text[j] === ".") {
          i = j;
          continue;
        }
        return text.slice(start, i + 1);
      }
    }
    i++;
  }
  return text.slice(start);
}

/** Ranges of text covered by a call to `name(` … `)`. */
export function callRanges(text: string, name: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pattern = new RegExp(String.raw`\b${name}\s*(?:<[^>]*>)?\s*\(`, "g");
  for (const match of text.matchAll(pattern)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) {
          ranges.push([match.index!, i]);
          break;
        }
      }
    }
  }
  return ranges;
}

export const within = (ranges: Array<[number, number]>, index: number): boolean =>
  ranges.some(([from, to]) => index >= from && index <= to);

/**
 * Strip comments but keep string literals.
 *
 * The emoji and tone rules have to see `aria-label="…"` and JSX text, so they
 * cannot use `stripCommentsAndStrings`. They do have to ignore commented-out
 * markup: the home page carries a disabled ticker bar full of emoji, and a
 * rule that fails on dead code teaches people to delete the rule.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1 ");
}

/** The body of a named function or component declaration. */
export function functionBody(text: string, name: string): string | null {
  const start = text.search(
    new RegExp(String.raw`(?:export\s+)?function\s+${name}\s*[(<]`),
  );
  if (start < 0) return null;

  const open = text.indexOf("{", text.indexOf(")", start));
  if (open < 0) return null;

  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}
