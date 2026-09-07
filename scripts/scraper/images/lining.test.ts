/**
 * liningbadminton.vn: the listing names the matcher has to reduce, the bundles
 * it has to refuse, and the catalogue spellings it has to reach.
 *
 * The fixtures are the shape of the real product records, trimmed. What each
 * one stands in for is named in the test, because every rule in this provider
 * exists because a listing on that shop has it.
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { splitColourway } from "../colourway";
import { discoverCandidates } from "./discover";
import { bestMatch, type MatchCandidate } from "./match";
import { resolvePageOwnership } from "./ownership";
import { providerById, type ProviderConfig } from "./providers";
import { slugify } from "../normalizer";

const provider = providerById("lining-vn");
const ORIGIN = "https://liningbadminton.vn";

/** What `cleanTitle` in discover.ts does with this provider's hooks. */
function cleaned(title: string, handle = "x"): string {
  assert.ok(provider, "the lining-vn provider is registered");
  const url = `${ORIGIN}/products/${handle}`;
  let text = title;
  for (const pattern of provider.titleNoise ?? []) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (provider.titleTransform) text = provider.titleTransform(text, url);
  return text.replace(/\s+/g, " ").trim();
}

function candidateFor(title: string, handle: string): MatchCandidate {
  return { url: `${ORIGIN}/products/${handle}`, slug: slugify(handle), title: cleaned(title, handle) };
}

/* --------------------------------------------------------------- reduction */

test("a listing name reduces to the frame the catalogue holds", () => {
  // Category, brand, series, grade, colour and the code Li-Ning prints on the
  // frame all come off; the model is what is left.
  for (const [listing, model] of [
    ["Vợt cầu lông Li-Ning Fengying BLADEX SPIRAL Pink (4U) AYPT365-4 (Khung vợt)", "BLADEX SPIRAL"],
    ["Vợt cầu lông Li-Ning Axforce 20 (4U) P-AYPT293-4A (Khung vợt)", "Axforce 20"],
    ["Vợt cầu lông  3D Calibar 200 AYPM394-4 (Khung vợt)", "3D Calibar 200"],
    // A bare "Vợt" prefix instead of the full category.
    ["Vợt Li Ning Aeronaut 4000C AYPM444-3 (Khung vợt)", "Aeronaut 4000C"],
    // The grade sits mid-name, so it cannot be left for the colour splitter.
    ["Vợt cầu lông Li-Ning AXFORCE CANNON (5U) White AYPT311-5 (Khung vợt)", "AXFORCE CANNON"],
    // A promotion in square brackets, and a code with a letter suffix.
    [
      "Vợt cầu lông Li-Ning 3D Calibar 600 P-AYPT385-4E  [Tặng kèm 01 hộp cầu Li-Ning AYQN024] (Khung vợt)",
      "3D Calibar 600",
    ],
  ] as const) {
    assert.equal(cleaned(listing), model);
  }
});

test("the shop's two misspellings are repaired rather than worked around", () => {
  // Each is consistent enough to name, and the SKU beside it agrees on which
  // frame the listing is for.
  assert.equal(cleaned("Vợt cầu lông TURBOCHAGING 01D P-AYPP032-4 (Khung vợt)"), "Turbo Charging 01D");
  assert.equal(cleaned("Vợt cầu lông LightNing 2000 Bule AYPT457-4 (Khung vợt)"), "LightNing 2000");
});

test("Thunder and Axforce are settled on one spelling so colourway pages merge", () => {
  // The shop uses both words for one line, sometimes in the same title. Left
  // alone, the BigBang New reads as two rackets and three of its four pages go
  // unclaimed.
  for (const [listing, model] of [
    ["Vợt cầu lông Li-Ning Thunder BIGBANG NEW (4U) Black AYPU049-4 (Khung vợt)", "Axforce BIGBANG NEW"],
    ["Vợt cầu lông Li-Ning Axforce BIGBANG NEW (4U) White AYPU051-4 (Khung vợt)", "Axforce BIGBANG NEW"],
    ["Vợt cầu lông Li-Ning Thunder Axforce JR (5U) Black AYPT299-5 (Khung vợt)", "Axforce JR"],
    ["Vợt cầu lông Li-Ning Axforce Thunder Cannon Blue (4U) AYPU039-4 (Khung vợt)", "Axforce Cannon"],
    ["Vợt cầu lông Li Ning Axforce Thunder 10 (4U) White AYPU105-4 (Khung vợt)", "Axforce 10"],
  ] as const) {
    assert.equal(cleaned(listing), model);
  }

  // And the four pages of the BigBang New then group as one racket.
  const match = bestMatch("Axforce BigBang new", "Li-Ning", [
    candidateFor("Vợt cầu lông Li-Ning Thunder BIGBANG NEW (4U) Black AYPU049-4", "a-4u-black"),
    candidateFor("Vợt cầu lông Li-Ning Axforce BIGBANG NEW (4U) White AYPU051-4", "b-4u-white"),
    candidateFor("Vợt cầu lông Li-Ning Thunder BIGBANG NEW (5U) Black AYPU049-5", "c-5u-black"),
  ]);
  assert.ok(match, "the BigBang New should match");
  assert.equal(match.rivals.length, 0);
  assert.equal(match.siblings.length + 1, 3, "all three pages are one racket");
});

test("a colour name that is part of the model survives the splitter", () => {
  // "Black-Iron - Pale Gold" is a colourway of the Black-Iron; "Black" leads
  // the model name and must not be eaten with it.
  assert.equal(cleaned("Vợt cầu lông Li-Ning Black-Iron - Pale Gold P-AYPT471-4 (Khung vợt)"), "Black-Iron");
  assert.equal(cleaned("Vợt Cầu Lông Li-Ning Black-Iron - Fire Red P-AYPT467-4 (Khung vợt)"), "Black-Iron");
  // The modifiers that makes those work cannot start a run on their own.
  assert.equal(splitColourway("Fire Power").colourway, null);
  assert.equal(splitColourway("Pale").colourway, null);
});

/* ---------------------------------------------------------------- refusals */

test("a bundle is refused before the matcher sees it", () => {
  const excludeTitle = provider?.excludeTitle;
  assert.ok(excludeTitle);
  const excluded = (title: string) => excludeTitle.some((p) => p.test(cleaned(title)));

  // A frame sold with a bag, shoes or shuttles, photographed as the bundle.
  assert.ok(excluded("SET Vợt cầu lông Li-Ning phiên bản LÂM AYPT061-4 (Khung vợt)"));
  assert.ok(excluded("Combo Li-Ning Axforce 60 (4U) P-AYPT281-4"));
  assert.ok(
    excluded("Set Vợt cầu lông Li-Ning Halbertec 9000 Limited - Olympic Paris 2024 P-AYPU115-88C"),
  );
  for (const kept of [
    "Vợt cầu lông Li-Ning Axforce 20 (4U) AYPT293-4 (Khung vợt)",
    "Vợt cầu lông Li-Ning Tectonic 1 (4U) AYPT423-4 (Khung vợt)",
  ]) {
    assert.equal(excluded(kept), false, `${kept} should be kept`);
  }
});

test("a short catalogue stub does not take a longer frame's page", () => {
  // "Aeronaut" and "Axforce 80" are catalogue rows with no model number of
  // their own, and the matcher's SKU allowance lets each accept a page that
  // belongs to a real frame. `resolvePageOwnership` is what refuses them.
  const page = {
    url: `${ORIGIN}/products/vot-cau-long-li-ning-thunder-80jr-5u-ayps083-1`,
    slug: "vot-cau-long-li-ning-thunder-80jr-5u-ayps083-1",
    title: "Axforce 80 JR",
  };
  const job = (id: string, slug: string, name: string, tier: "exact" | "coded") => ({
    racket: { id, slug, name, brandSlug: "li-ning", brandName: "Li-Ning", equivalentIds: [id] },
    provider: provider as ProviderConfig,
    pages: [page],
    tier,
    candidatesConsidered: 1,
    alternatives: [],
  });

  const result = resolvePageOwnership([
    job("r-li-ning-axforce-80", "li-ning-axforce-80", "Axforce 80", "coded"),
    job("r-li-ning-axforce-80-jr", "li-ning-axforce-80-jr", "Axforce 80 JR", "exact"),
  ]);

  assert.deepEqual(
    result.jobs.map((j) => j.racket.id),
    ["r-li-ning-axforce-80-jr"],
  );
  assert.equal(result.rejected[0].racketId, "r-li-ning-axforce-80");
});

/* ----------------------------------------------------------------- aliases */

test("the catalogue's other spellings are offered, and only as aliases", () => {
  const aliases = (name: string) => provider?.modelAliases?.(name) ?? [];

  // The Windstorm line is sold here as Storm.
  assert.ok(aliases("Windstorm 72 Power").includes("Storm 72 Power"));
  // A family name run onto its model, spaced the way the shop writes it.
  assert.ok(aliases("Blackiron").includes("Black-Iron"));
  assert.ok(aliases("Turbocharging N9").includes("Turbo Charging N9"));
  // Li-Ning's series names, which the shop prints and most retailer rows omit.
  assert.ok(aliases("Fengying Bladex 900").includes("Bladex 900"));
  assert.ok(aliases("Axforce BigBang new").includes("BigBang new"));

  // An alias never displaces a direct match: the frame the shop names outright
  // keeps its own page.
  const candidates = [
    candidateFor("Vợt cầu lông Li-Ning Axforce 20 (4U) AYPT293-4 (Khung vợt)", "axforce-20"),
    candidateFor("Vợt cầu lông Li-Ning Storm 72 Power (6U) P-AYPU071-6 (Khung vợt)", "storm-72-power"),
  ];
  const direct = bestMatch("Axforce 20", "Li-Ning", candidates);
  assert.ok(direct);
  assert.equal(direct.candidate.slug, "axforce-20");
});

/* --------------------------------------------------------------- discovery */

test("the collection is read through the Haravan product API, gallery included", async () => {
  assert.ok(provider, "the lining-vn provider is registered");
  const source = Array.isArray(provider.catalogue) ? provider.catalogue[0] : provider.catalogue;
  assert.equal(source.kind, "shopify-collection");

  const product = (handle: string, title: string, type: string, images: string[]) => ({
    handle,
    title,
    product_type: type,
    images: images.map((src, i) => ({ src, position: i + 1 })),
  });

  const pages: Record<string, unknown> = {
    // Haravan caps a page at 50 whatever `limit` asks for; the walk ends on the
    // first empty page rather than on a count.
    [`${ORIGIN}/collections/vot-cau-long/products.json?limit=250&page=1`]: {
      products: [
        product("axforce-20", "Vợt cầu lông Li-Ning Axforce 20 (4U) AYPT293-4 (Khung vợt)", "Vợt cầu lông", [
          "https://cdn.hstatic.net/products/1/axforce-20-a.jpg",
          "https://cdn.hstatic.net/products/1/axforce-20-b.jpg",
        ]),
        // A different capitalisation of the same product type, which the filter
        // has to admit.
        product("tectonic-1", "Vợt Cầu Lông Li-Ning Tectonic 1 (4U) AYPT423-4 (Khung vợt)", "Vợt Cầu Lông", [
          "https://cdn.hstatic.net/products/1/tectonic-1.jpg",
        ]),
        // Not a racket: the filter is what keeps a bag out of the racket walk.
        product("bao-vot", "Bao vợt Li-Ning ABJT001", "Bao vợt", [
          "https://cdn.hstatic.net/products/1/bag.jpg",
        ]),
      ],
    },
    [`${ORIGIN}/collections/vot-cau-long/products.json?limit=250&page=2`]: { products: [] },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /search", { status: 200 });
    const body = pages[url];
    if (body === undefined) return new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };

  try {
    const result = await discoverCandidates(provider as ProviderConfig, {
      userAgent: "ShuttlecraftImageBot/1.0",
      timeoutMs: 1_000,
      delayMs: 0,
      refresh: true,
      verbose: false,
    });

    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.candidates.map((c) => ({ slug: c.slug, title: c.title, images: c.images?.length })),
      [
        // The gallery arrives with the product, so no product page is fetched.
        { slug: "axforce-20", title: "Axforce 20", images: 2 },
        { slug: "tectonic-1", title: "Tectonic 1", images: 1 },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(resolve("scripts/scraper/output/sitemaps/lining-vn.json"), { force: true });
  }
});
