import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderConfig } from "./providers";
import { resolvePageOwnership, type ImageJob } from "./ownership";

const provider: ProviderConfig = {
  id: "yonex",
  name: "Yonex",
  origin: "https://manufacturer.test",
  brandSlugs: ["yonex"],
  platform: "structured-data",
  catalogue: {
    kind: "sitemap",
    sitemaps: [],
    productUrlPattern: /.*/,
  },
};

function job(
  id: string,
  slug: string,
  name: string,
  pages: ImageJob["pages"],
  overrides: Partial<ImageJob> = {},
): ImageJob {
  return {
    racket: {
      id,
      slug,
      name,
      brandSlug: "yonex",
      brandName: "Yonex",
      equivalentIds: [id],
    },
    provider,
    pages,
    tier: "exact",
    candidatesConsidered: 1,
    alternatives: [],
    ...overrides,
  };
}

test("an exact product title beats a shorter coded-prefix claim", () => {
  const page = {
    url: "https://manufacturer.test/astrox-22-rx",
    slug: "astrox-22-rx",
    title: "ASTROX 22 RX",
  };

  const result = resolvePageOwnership([
    job("r-astrox-22", "yonex-astrox-22", "Astrox 22", [page], { tier: "coded" }),
    job("r-astrox-22-rx", "yonex-astrox-22-rx", "Astrox 22 RX", [page]),
  ]);

  assert.deepEqual(result.jobs.map((entry) => entry.racket.id), ["r-astrox-22-rx"]);
  assert.equal(result.rejected[0].racketId, "r-astrox-22");
  assert.equal(result.rejected[0].winnerRacketId, "r-astrox-22-rx");
});

test("variant pages are split away from a generic model", () => {
  const hf = {
    url: "https://manufacturer.test/ax3dg-hf",
    slug: "ax3dg-hf",
    title: "ASTROX 3 DG HF",
  };
  const st = {
    url: "https://manufacturer.test/ax3dg-st",
    slug: "ax3dg-st",
    title: "ASTROX 3 DG ST",
  };

  const result = resolvePageOwnership([
    job("r-generic", "yonex-astrox-3-dg", "Astrox 3 DG", [hf, st], { tier: "coded" }),
    job("r-hf", "yonex-astrox-3-dg-hf", "Astrox 3 DG HF", [hf]),
    job("r-st", "yonex-astrox-3-dg-st", "Astrox 3 DG ST", [st]),
  ]);

  assert.deepEqual(
    result.jobs.map((entry) => [entry.racket.id, entry.pages.map((page) => page.url)]),
    [
      ["r-hf", [hf.url]],
      ["r-st", [st.url]],
    ],
  );
});

test("the manufacturer's full name beats a catalogue abbreviation alias", () => {
  const victor: ProviderConfig = {
    ...provider,
    id: "victor",
    name: "Victor",
    brandSlugs: ["victor"],
    modelAliases: (name) =>
      name.startsWith("ARS ") ? [name.replace(/^ARS /, "Auraspeed ")] : [],
  };
  const page = {
    url: "https://manufacturer.test/auraspeed-30h-d",
    slug: "auraspeed-30h-d",
    title: "AURASPEED 30H",
  };
  const abbreviated = job("r-ars", "victor-ars-30h", "ARS 30H", [page], {
    provider: victor,
    matchedAs: "Auraspeed 30H",
  });
  abbreviated.racket.brandSlug = "victor";
  abbreviated.racket.brandName = "Victor";
  const full = job("r-full", "victor-auraspeed-30h", "Auraspeed 30H", [page], {
    provider: victor,
  });
  full.racket.brandSlug = "victor";
  full.racket.brandName = "Victor";

  assert.deepEqual(resolvePageOwnership([abbreviated, full]).jobs.map((entry) => entry.racket.id), [
    "r-full",
  ]);
});

test("a losing primary claim can fall back to another provider", () => {
  const contested = {
    url: "https://manufacturer.test/astrox-22-rx",
    slug: "astrox-22-rx",
    title: "ASTROX 22 RX",
  };
  const fallbackPage = {
    url: "https://regional.test/astrox-22",
    slug: "astrox-22",
    title: "ASTROX 22",
  };
  const fallbackProvider = { ...provider, id: "yonex-regional", origin: "https://regional.test" };
  const generic = job("r-generic", "yonex-astrox-22", "Astrox 22", [contested], {
    tier: "coded",
    alternatives: [
      {
        ...job("r-generic", "yonex-astrox-22", "Astrox 22", [fallbackPage]),
        provider: fallbackProvider,
      },
    ],
  });
  const specific = job("r-specific", "yonex-astrox-22-rx", "Astrox 22 RX", [contested]);

  const result = resolvePageOwnership([generic, specific]);
  assert.deepEqual(
    result.jobs.map((entry) => [entry.racket.id, entry.provider.id]),
    [
      ["r-generic", "yonex-regional"],
      ["r-specific", "yonex"],
    ],
  );
});

test("a page's owner has to be in the pool to keep it", () => {
  // Why `index.ts` matches rackets that already have images instead of skipping
  // them before the contest. This catalogue holds near-duplicate rows from
  // retailer listings — "Woven 888II" beside "woven 888 II" — and only the
  // contest tells them apart. Take the winner out of the pool and the page does
  // not go unclaimed; it goes to the loser, which then writes over an owner the
  // database already recorded.
  const page = {
    url: "http://fleet.vn/chi-tiet-san-pham/vot-cau-long-fleet-woven-888-ii/221",
    slug: "woven-888-ii",
    title: "Woven 888 II",
  };

  const both = resolvePageOwnership([
    job("r-fleet-woven-888ii", "fleet-woven-888ii", "Woven 888II", [page]),
    job("r-fleet-woven-888-ii", "fleet-woven-888-ii", "woven 888 II", [page]),
  ]);
  assert.deepEqual(both.jobs.map((entry) => entry.racket.id), ["r-fleet-woven-888-ii"]);
  assert.equal(both.rejected[0].racketId, "r-fleet-woven-888ii");

  const winnerRemoved = resolvePageOwnership([
    job("r-fleet-woven-888ii", "fleet-woven-888ii", "Woven 888II", [page]),
  ]);
  assert.deepEqual(winnerRemoved.jobs.map((entry) => entry.racket.id), ["r-fleet-woven-888ii"]);
  assert.equal(winnerRemoved.rejected.length, 0, "nothing is left to contest the page");
});
