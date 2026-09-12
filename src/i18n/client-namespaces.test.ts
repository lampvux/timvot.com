import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLIENT_NAMESPACES, clientMessages } from "./client-namespaces";

/**
 * Keeps `CLIENT_NAMESPACES` honest.
 *
 * The root provider now ships only the namespaces on that list. A Client
 * Component that reads one which is *not* on it does not fail to compile — it
 * fails at runtime, in the browser, with a missing-message error, on whichever
 * route happens to render it. So the list is derived here from the source and
 * compared, and the failure lands in CI instead.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : [];
  });
}

/** Every module that runs in the browser, and every namespace it reads. */
function namespacesUsedByClientModules(): Map<string, string[]> {
  const byNamespace = new Map<string, string[]>();

  for (const path of walk(src)) {
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
    const source = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/m.test(source)) continue;

    for (const match of source.matchAll(/useTranslations\(\s*["']([A-Za-z]+)["']\s*\)/g)) {
      const namespace = match[1];
      const files = byNamespace.get(namespace) ?? [];
      files.push(path.slice(src.length + 1));
      byNamespace.set(namespace, files);
    }
  }

  return byNamespace;
}

test("every namespace a Client Component reads is shipped to the client", () => {
  const used = namespacesUsedByClientModules();
  const shipped = new Set<string>(CLIENT_NAMESPACES);

  const unshipped = [...used.entries()].filter(([namespace]) => !shipped.has(namespace));

  assert.deepEqual(
    unshipped.map(([namespace, files]) => `${namespace} (${files.join(", ")})`),
    [],
    "These namespaces are read in the browser but are not in CLIENT_NAMESPACES. " +
      "They would throw a missing-message error at runtime. Add them to " +
      "src/i18n/client-namespaces.ts.",
  );
});

test("nothing is shipped that no Client Component reads", () => {
  const used = namespacesUsedByClientModules();
  const unused = CLIENT_NAMESPACES.filter((namespace) => !used.has(namespace));

  assert.deepEqual(
    [...unused],
    [],
    "These namespaces are shipped to every visitor on every route and nothing " +
      "in the browser reads them. Remove them from CLIENT_NAMESPACES.",
  );
});

test("no Client Component asks for the whole message file", () => {
  // `useTranslations()` with no namespace reads from the root, which would
  // need every message shipped and silently undo this whole arrangement.
  for (const path of walk(src)) {
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
    const source = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/m.test(source)) continue;

    assert.ok(
      !/useTranslations\(\s*\)/.test(source),
      `${path.slice(src.length + 1)} calls useTranslations() with no namespace.`,
    );
    assert.ok(
      !/\buseMessages\s*\(/.test(source),
      `${path.slice(src.length + 1)} calls useMessages(), which reads all of them.`,
    );
  }
});

test("the filter actually drops the server-only namespaces", () => {
  const messages = JSON.parse(
    readFileSync(join(src, "..", "messages", "vi.json"), "utf8"),
  ) as Record<string, unknown>;

  const picked = clientMessages(messages);

  assert.ok(Object.keys(messages).length > Object.keys(picked).length);
  // The largest server-only namespaces, named so a regression is obvious.
  for (const namespace of ["home", "deals", "methodology", "strings", "dashboard"]) {
    assert.ok(namespace in messages, `vi.json should still have ${namespace}`);
    assert.ok(!(namespace in picked), `${namespace} should not reach the client`);
  }

  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  assert.ok(
    bytes(picked) < bytes(messages) * 0.8,
    `the client payload should be meaningfully smaller: ` +
      `${bytes(picked)} vs ${bytes(messages)} bytes`,
  );
});
