import assert from "node:assert/strict";
import test from "node:test";
import {
  clientFiles,
  importedModules,
  list,
  namedImportsFrom,
  read,
  sourceFiles,
  stripCommentsAndStrings,
} from "./source";

/**
 * What may cross into the browser, and what must stay on the server.
 *
 * Three separate rules, all with the same shape of cost: each one was a single
 * innocuous-looking line that multiplied by the size of the catalogue.
 *
 *   - `RacketCard` was a Client Component because of one `useState` for an
 *     image fallback, which shipped 3010 component instances per page.
 *   - `import { icons } from "lucide-react"` pulls ~1500 glyphs into the
 *     bundle and defeats `optimizePackageImports`, which can only rewrite
 *     named imports.
 *   - A URL hook read outside a `<Suspense>` boundary is runtime data under
 *     Cache Components, so it blocks the static shell for every route the
 *     component appears on — and for site chrome that is all of them.
 */

/* --------------------------------------------------------------- the icons */

test("icons are imported by name, never as the barrel", () => {
  const offenders = sourceFiles()
    .filter((file) => {
      const named = namedImportsFrom(stripCommentsAndStrings(file.text), "lucide-react");
      return named?.includes("icons");
    })
    .map((file) => file.path);

  assert.deepEqual(
    offenders,
    [],
    `${list(offenders)} imports the lucide barrel. That single export holds ` +
      `~1500 glyphs, all of which land in the client bundle because ` +
      `optimizePackageImports can only rewrite named imports. Add the icon to ` +
      `the registry in components/ds/primitives.tsx instead.`,
  );
});

test("no file imports lucide with a namespace or default import", () => {
  const offenders = sourceFiles()
    .filter((file) =>
      /import\s+(?:\*\s+as\s+\w+|\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']lucide-react["']/.test(
        stripCommentsAndStrings(file.text),
      ),
    )
    .map((file) => file.path);

  assert.deepEqual(
    offenders,
    [],
    `${list(offenders)} imports lucide-react as a namespace or default, which ` +
      `has the same effect as the barrel.`,
  );
});

test("the icon registry is an explicit list of named imports", () => {
  const primitives = read("components", "ds", "primitives.tsx");
  const named = namedImportsFrom(primitives, "lucide-react");

  assert.ok(named, "components/ds/primitives.tsx no longer imports any icon.");
  assert.ok(
    named.length > 5,
    "the icon registry looks empty; the design uses more than five icons.",
  );
  assert.ok(
    !named.includes("icons"),
    "the registry itself went back to the barrel.",
  );
});

/* ------------------------------------------------- the server/client divide */

/** Modules that read the catalogue, and therefore cannot cross the boundary. */
const SERVER_ONLY_MODULES = [
  "@/lib/data/repository",
  "@/lib/data/catalog-page",
  "@/lib/data/string-repository",
  "@/lib/supabase/server",
];

test("no Client Component imports the read path", () => {
  const offenders: string[] = [];

  for (const file of clientFiles()) {
    const modules = importedModules(file.text);
    for (const forbidden of SERVER_ONLY_MODULES) {
      if (modules.includes(forbidden)) {
        offenders.push(`${file.path} → ${forbidden}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${list(offenders)}. A "use client" file that imports the repository ` +
      `either breaks the build or drags the catalogue into the bundle. Fetch ` +
      `on the server and pass the result as a prop.`,
  );
});

test("the card grid renders on the server", () => {
  // RacketCard was the original 3010-instances-per-page regression. The split
  // is deliberate: `racket-card.tsx` is the server component, and
  // `racket-card-view.tsx` is the interactive leaf.
  const card = read("components", "racket-card.tsx");

  assert.ok(
    !/^\s*["']use client["']/m.test(card),
    `components/racket-card.tsx is a Client Component again. At 24 cards a ` +
      `page that is 24 instances hydrating for what the server already ` +
      `rendered; put the boundary on the button or image that needs it.`,
  );
});

/* ------------------------------------------------------------- the URL hooks */

const URL_HOOKS = [
  "usePathname",
  "useSearchParams",
  "useParams",
  "useSelectedLayoutSegment",
  "useSelectedLayoutSegments",
];

/**
 * A URL hook needs a boundary, unless the prerender never reaches it.
 *
 * Three legitimate shapes, and this map is how the two that are not visible in
 * the file itself stay honest:
 *
 *   `importer`  the component is wrapped in <Suspense> by whoever renders it.
 *               The test checks that the named file really does wrap it.
 *   `guard`     the call sits behind an early return that a prerender always
 *               takes — the compare tray is empty until localStorage is read,
 *               so no boundary is needed and nothing has to settle.
 */
const BOUNDARY_ELSEWHERE: Record<
  string,
  { importer?: string; component?: string; guard?: string }
> = {
  "src/components/navigation-progress.tsx": {
    importer: "src/app/[locale]/layout.tsx",
    component: "NavigationProgress",
  },
  "src/components/compare-tray.tsx": {
    guard: "CompareTray returns null until the provider has read localStorage",
  },
};

test("every URL hook is behind a boundary, or behind a hydration guard", () => {
  const unexplained: string[] = [];

  for (const file of sourceFiles()) {
    const code = stripCommentsAndStrings(file.text);
    const hooks = URL_HOOKS.filter((hook) =>
      new RegExp(`\\b${hook}\\s*\\(`).test(code),
    );
    if (hooks.length === 0) continue;

    // i18n/navigation.ts re-exports the hooks; it calls none of them.
    if (file.path.endsWith("i18n/navigation.ts")) continue;

    if (code.includes("<Suspense")) continue;

    const exemption = BOUNDARY_ELSEWHERE[file.path];
    if (!exemption) {
      unexplained.push(`${file.path} (${hooks.join(", ")})`);
      continue;
    }

    if (exemption.importer) {
      const importer = read(
        ...exemption.importer.replace(/^src\//, "").split("/"),
      );
      const wrapped = new RegExp(
        `<Suspense[^>]*>[\\s\\S]{0,200}<${exemption.component}`,
      ).test(importer);
      assert.ok(
        wrapped,
        `${file.path} relies on ${exemption.importer} for its boundary, but ` +
          `that file no longer wraps <${exemption.component}> in <Suspense>.`,
      );
    }
  }

  assert.deepEqual(
    unexplained,
    [],
    `${list(unexplained)} reads the URL with no <Suspense> in the file and no ` +
      `entry in BOUNDARY_ELSEWHERE. Under Cache Components that blocks the ` +
      `static shell for every route the component appears on.`,
  );
});

test("the exemptions are all still needed", () => {
  const stale = Object.keys(BOUNDARY_ELSEWHERE).filter((path) => {
    const file = sourceFiles().find((f) => f.path === path);
    if (!file) return true;
    const code = stripCommentsAndStrings(file.text);
    const usesHook = URL_HOOKS.some((hook) =>
      new RegExp(`\\b${hook}\\s*\\(`).test(code),
    );
    return !usesHook || code.includes("<Suspense");
  });

  assert.deepEqual(
    stale,
    [],
    `${list(stale)} no longer needs its BOUNDARY_ELSEWHERE entry — it either ` +
      `stopped reading the URL or grew its own boundary. Remove the entry so ` +
      `the exemption cannot outlive the reason for it.`,
  );
});

test("site chrome keeps its links in the static shell", () => {
  // The rule this encodes: put the boundary around the part that needs the
  // value, not the whole component. The links stay crawlable and clickable in
  // the shell; only the active highlight streams.
  const chrome = read("components", "site-chrome.tsx");

  assert.ok(
    /<Suspense[^>]*fallback=\{<NavLinks pathname=\{null\}/.test(chrome),
    `components/site-chrome.tsx no longer renders the nav links as its own ` +
      `Suspense fallback. Without that the whole header waits on the URL.`,
  );
});
