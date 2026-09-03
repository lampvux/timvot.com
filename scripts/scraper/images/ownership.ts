import { slugify } from "../normalizer";

import { compare, tokenise, type MatchCandidate, type MatchTier } from "./match";
import type { ProviderConfig } from "./providers";
import { modelSlugOf, type RacketTarget } from "./targets";

export interface ImageJobOption {
  racket: RacketTarget;
  provider: ProviderConfig;
  pages: MatchCandidate[];
  tier: MatchTier;
  matchedAs?: string;
  candidatesConsidered: number;
}

export interface ImageJob extends ImageJobOption {
  alternatives: ImageJobOption[];
}

export interface RejectedPageClaim {
  pageUrl: string;
  racketId: string;
  racketSlug: string;
  winnerRacketId: string;
  winnerRacketSlug: string;
}

interface RankedClaim {
  jobIndex: number;
  page: MatchCandidate;
  rank: number;
  titleAffinity: number;
  urlAffinity: number;
  specificity: number;
  racketId: string;
}

function tierFor(
  modelName: string,
  brandName: string,
  candidate: MatchCandidate,
  source: "title" | "slug",
): MatchTier | null {
  const value = source === "title" ? candidate.title : candidate.slug;
  if (!value) return null;
  return compare(tokenise(modelName), value, tokenise(brandName));
}

/**
 * Rank one racket's claim on one manufacturer product page.
 *
 * A product title is stronger evidence than its CMS URL, an exact match is
 * stronger than the narrow SKU-suffix allowance, and the catalogue's own name
 * is stronger than an alias. Those rules are deliberately lexicographic rather
 * than a fuzzy score: a page named "ASTROX 22 RX" must belong to the 22 RX row,
 * never to the shorter "ASTROX 22" row merely because `RX` looks code-like.
 */
function rankClaim(jobIndex: number, job: ImageJobOption, page: MatchCandidate): RankedClaim {
  const forms = [
    { name: job.racket.name, alias: false },
    ...(job.provider.modelAliases?.(job.racket.name) ?? []).map((name) => ({
      name,
      alias: true,
    })),
  ];

  let rank = Number.POSITIVE_INFINITY;

  for (const form of forms) {
    const titleTier = tierFor(form.name, job.racket.brandName, page, "title");
    const slugTier = tierFor(form.name, job.racket.brandName, page, "slug");
    const candidates = [
      titleTier === "exact" ? (form.alias ? 1 : 0) : Infinity,
      slugTier === "exact" ? (form.alias ? 3 : 2) : Infinity,
      titleTier === "coded" ? (form.alias ? 5 : 4) : Infinity,
      slugTier === "coded" ? (form.alias ? 7 : 6) : Infinity,
    ];
    rank = Math.min(rank, ...candidates);
  }

  const modelSlug = modelSlugOf(job.racket.slug, job.racket.brandSlug);
  const titleSlug = page.title ? slugify(page.title) : "";

  return {
    jobIndex,
    page,
    rank,
    titleAffinity: titleSlug === modelSlug ? 0 : 1,
    urlAffinity: page.slug === modelSlug ? 0 : 1,
    specificity: tokenise(job.racket.name).length,
    racketId: job.racket.id,
  };
}

function compareClaims(a: RankedClaim, b: RankedClaim): number {
  return (
    a.rank - b.rank ||
    a.titleAffinity - b.titleAffinity ||
    a.urlAffinity - b.urlAffinity ||
    b.specificity - a.specificity ||
    a.racketId.localeCompare(b.racketId)
  );
}

/**
 * Give every source product page one database owner.
 *
 * Matching used to happen independently per racket, so a coded prefix match
 * and an exact match could both crawl the same page into different Storage
 * folders. This pass compares those claims globally. A loser may fall back to
 * its next configured provider; if it has no unclaimed page left, it is left
 * out of the crawl rather than receiving another racket's photography.
 */
export function resolvePageOwnership(input: ImageJob[]): {
  jobs: ImageJob[];
  rejected: RejectedPageClaim[];
} {
  const states = input.map((job) => ({
    options: [
      {
        racket: job.racket,
        provider: job.provider,
        pages: job.pages,
        tier: job.tier,
        matchedAs: job.matchedAs,
        candidatesConsidered: job.candidatesConsidered,
      },
      ...job.alternatives,
    ],
    optionIndex: 0,
  }));
  const rejected = new Map<string, RejectedPageClaim>();

  for (;;) {
    const active = states
      .map((state, stateIndex) => ({ stateIndex, option: state.options[state.optionIndex] }))
      .filter((entry): entry is { stateIndex: number; option: ImageJobOption } =>
        Boolean(entry.option),
      );
    const claimsByPage = new Map<string, RankedClaim[]>();

    for (const { stateIndex, option } of active) {
      for (const page of option.pages) {
        const claim = rankClaim(stateIndex, option, page);
        const claims = claimsByPage.get(page.url) ?? [];
        claims.push(claim);
        claimsByPage.set(page.url, claims);
      }
    }

    const wonPages = new Map<number, MatchCandidate[]>();
    for (const claims of claimsByPage.values()) {
      claims.sort(compareClaims);
      const winner = claims[0];
      const winnerOption = states[winner.jobIndex].options[states[winner.jobIndex].optionIndex];
      wonPages.set(winner.jobIndex, [
        ...(wonPages.get(winner.jobIndex) ?? []),
        winner.page,
      ]);

      for (const loser of claims.slice(1)) {
        const loserOption = states[loser.jobIndex].options[states[loser.jobIndex].optionIndex];
        const key = `${loser.page.url}\n${loserOption.racket.id}`;
        rejected.set(key, {
          pageUrl: loser.page.url,
          racketId: loserOption.racket.id,
          racketSlug: loserOption.racket.slug,
          winnerRacketId: winnerOption.racket.id,
          winnerRacketSlug: winnerOption.racket.slug,
        });
      }
    }

    let promoted = false;
    for (const { stateIndex } of active) {
      if ((wonPages.get(stateIndex) ?? []).length > 0) continue;
      const state = states[stateIndex];
      if (state.optionIndex + 1 < state.options.length) {
        state.optionIndex++;
        promoted = true;
      }
    }
    if (promoted) continue;

    const jobs: ImageJob[] = [];
    for (const { stateIndex, option } of active) {
      const pages = wonPages.get(stateIndex) ?? [];
      if (pages.length === 0) continue;
      const state = states[stateIndex];
      jobs.push({
        ...option,
        pages,
        alternatives: state.options.slice(state.optionIndex + 1),
      });
    }

    return { jobs, rejected: [...rejected.values()] };
  }
}
