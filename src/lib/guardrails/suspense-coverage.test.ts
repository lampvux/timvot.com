import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { SRC, list, sourceFiles } from "./source";

/**
 * A route that awaits data says so while it waits.
 *
 * Without a `loading.tsx` or a `<Suspense>` the browser holds the *previous*
 * page until the server has finished — on the catalogue that meant seconds of
 * a screen that looked frozen rather than busy. Skeletons match the real
 * layout's box sizes so nothing shifts when the content lands.
 *
 * The nuance this file has to respect: under Cache Components a fully
 * prerendered route never makes the visitor wait at all, so it needs no
 * boundary. Whether a given route prerenders is a fact about the build, not
 * about the source — `scripts/route-report.ts` is where that check lives,
 * because it reads the route table. What is checkable here is the inventory:
 * which data-reading routes have a boundary today, and a failure the moment a
 * new one appears without one.
 */

const DATA_MODULES = [
  "@/lib/data/repository",
  "@/lib/data/catalog-page",
  "@/lib/data/string-repository",
];

interface Route {
  /** Repo-relative path of the page file. */
  path: string;
  /** Route directory, relative to `src/app`, as a URL-ish string. */
  route: string;
  readsData: boolean;
  hasLoading: boolean;
  hasSuspense: boolean;
}

function routes(): Route[] {
  return sourceFiles("app")
    .filter((file) => file.path.endsWith("/page.tsx"))
    .map((file) => {
      const dir = dirname(file.absolute);
      return {
        path: file.path,
        route:
          "/" +
          relative(join(SRC, "app"), dir).split(sep).join("/").replace(/^$/, ""),
        readsData: DATA_MODULES.some((m) => file.text.includes(`from "${m}"`)),
        hasLoading: existsSync(join(dir, "loading.tsx")),
        hasSuspense: file.text.includes("<Suspense"),
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Data-reading routes with no boundary of their own, as of today.
 *
 * Every one of these is a page whose data is cached and which therefore
 * prerenders — so the absence is not currently costing a visitor anything.
 * They are listed rather than ignored because that property is a build
 * outcome, not a guarantee: the day one of them goes dynamic, it goes dynamic
 * with no loading state, and the only warning would be the route table.
 *
 * The test below fails if a route is added to this list by accident *and* if
 * an entry stops being needed, so the inventory cannot quietly drift.
 */
const NO_BOUNDARY_TODAY = [
  "/[locale]",
  "/[locale]/account",
  "/[locale]/seller/dashboard",
  "/[locale]/seller/dashboard/listings/new",
  "/[locale]/strings",
  "/[locale]/strings/[brand]/[model]",
];

test("every data-reading route has a boundary, or is a known exception", () => {
  const missing = routes()
    .filter((r) => r.readsData && !r.hasLoading && !r.hasSuspense)
    .map((r) => r.route);

  const unexpected = missing.filter((route) => !NO_BOUNDARY_TODAY.includes(route));

  assert.deepEqual(
    unexpected,
    [],
    `${list(unexpected)} awaits catalogue data with no loading.tsx and no ` +
      `<Suspense>. Add a skeleton that matches the real layout's box sizes, ` +
      `so nothing shifts when the content lands.`,
  );
});

test("the boundary exceptions are all still real", () => {
  const missing = routes()
    .filter((r) => r.readsData && !r.hasLoading && !r.hasSuspense)
    .map((r) => r.route);

  const stale = NO_BOUNDARY_TODAY.filter((route) => !missing.includes(route));

  assert.deepEqual(
    stale,
    [],
    `${list(stale)} now has a boundary, or stopped reading data. Remove it ` +
      `from NO_BOUNDARY_TODAY.`,
  );
});

test("the catalogue and the racket detail page always have one", () => {
  // These two are the reason the rule exists: the catalogue held the browser
  // for seconds, and the detail page is the deepest read in the app.
  const byRoute = new Map(routes().map((r) => [r.route, r]));

  for (const route of ["/[locale]/rackets", "/[locale]/rackets/[brand]/[model]"]) {
    const found = byRoute.get(route);
    assert.ok(found, `${route} no longer exists.`);
    assert.ok(
      found.hasLoading || found.hasSuspense,
      `${route} lost its loading boundary. This is the page the rule was ` +
        `written for — rendering it used to hold the browser for seconds.`,
    );
  }
});

test("every loading.tsx sits beside a page it can cover", () => {
  const orphans = sourceFiles("app")
    .filter((file) => file.path.endsWith("/loading.tsx"))
    .filter((file) => !existsSync(join(dirname(file.absolute), "page.tsx")))
    .map((file) => file.path);

  assert.deepEqual(
    orphans,
    [],
    `${list(orphans)} has no sibling page.tsx. A loading file in a segment ` +
      `with no page still applies to everything below it, which is rarely ` +
      `what was meant.`,
  );
});

/**
 * A loading file either delegates to the shared skeletons or draws its own.
 *
 * Both are legitimate, and the codebase uses both: most routes render a
 * `CatalogSkeleton` and friends from `components/skeletons.tsx`, while the
 * racket detail page draws a bespoke shape because its layout — a 4/3 gallery
 * beside a spec grid and an offer table — is shared with nothing else. What is
 * not legitimate is a third option: a placeholder that neither reuses a sized
 * skeleton nor sizes anything itself.
 */
const SHARED_SKELETONS = "@/components/skeletons";
const delegates = (text: string) => text.includes(SHARED_SKELETONS);
const sizesItsOwn = (text: string) => /\b(h-|aspect-|min-h-)/.test(text);

test("every skeleton announces itself to a screen reader", () => {
  // A skeleton is a picture of a page that is not there. Sighted visitors read
  // the grey boxes as "loading"; without role/aria-busy a screen reader reads
  // the route as finished and empty.
  const loaders = sourceFiles("app").filter((f) => f.path.endsWith("/loading.tsx"));

  assert.ok(loaders.length > 0, "no loading.tsx files found at all.");

  const silent = loaders
    .filter((f) => !delegates(f.text))
    .filter((f) => !(f.text.includes('role="status"') && f.text.includes("aria-busy")))
    .map((f) => f.path);

  assert.deepEqual(
    silent,
    [],
    `${list(silent)} draws its own skeleton with no role="status" and ` +
      `aria-busy. Status is always colour and icon and a value — a loading ` +
      `state is no exception.`,
  );

  // And the shared module the rest delegate to has to carry it for them.
  const shared = sourceFiles("components").find((f) =>
    f.path.endsWith("components/skeletons.tsx"),
  );
  assert.ok(shared, "components/skeletons.tsx is gone.");
  assert.ok(
    shared.text.includes('role="status"') && shared.text.includes("aria-busy"),
    `components/skeletons.tsx no longer announces itself, and every route ` +
      `that delegates to it lost its announcement at the same time.`,
  );
});

test("no skeleton is an empty placeholder", () => {
  // Boxes have to match the real layout's sizes or the content shifts when it
  // lands, which is the shift the boundary was added to avoid.
  const thin = sourceFiles("app")
    .filter((f) => f.path.endsWith("/loading.tsx"))
    .filter((f) => !delegates(f.text) && !sizesItsOwn(f.text))
    .map((f) => f.path);

  assert.deepEqual(
    thin,
    [],
    `${list(thin)} neither reuses components/skeletons.tsx nor sizes any box ` +
      `of its own. A skeleton with no geometry shifts the layout the moment ` +
      `the content arrives.`,
  );

  const shared = sourceFiles("components").find((f) =>
    f.path.endsWith("components/skeletons.tsx"),
  );
  assert.ok(shared && sizesItsOwn(shared.text), "the shared skeletons size nothing.");
});
