/**
 * One shop must not be able to reach the shops after it.
 *
 * The site adapters already turn their own errors into `success: false`, but
 * "handles its own errors" is not the same as "cannot fail in a way I did not
 * think of", and there were two ways a single shop still took the whole run
 * down with it:
 *
 *  - an unexpected throw — a bug outside an adapter's own `try`, a parser that
 *    runs out of memory on a malformed page — propagated out of the site loop
 *    and past the rest of the run: no output file, no sync, no backup, and the
 *    healthy shops left unsynced;
 *  - a shop that answers slowly rather than not at all. Nothing had a deadline,
 *    so one hanging host held the queue behind it for as long as its retries
 *    lasted, which on a bad night is longer than the run itself.
 *
 * So a rejection becomes a skipped shop, and a shop that overruns its budget is
 * abandoned — its in-flight requests aborted through the signal it was handed,
 * so it stops consuming the runner rather than finishing quietly in the
 * background long after the run moved on.
 *
 * The walk is a parameter rather than an import so this is testable without a
 * network: see `guard.test.ts`.
 */

import type { ScraperResult, ScraperSource } from "./types";

export type SiteWalk = (source: ScraperSource, signal: AbortSignal) => Promise<ScraperResult>;

export interface WalkOptions {
  /** Per-shop budget in ms. `Infinity` waits for as long as a shop takes. */
  timeoutMs: number;
  onStart?: (source: ScraperSource) => void;
  onResult?: (result: ScraperResult) => void;
}

/** The budget, in the unit it was actually given in. */
export function describeBudget(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs)) return "no time limit";
  if (timeoutMs < 120_000) return `${Math.max(1, Math.round(timeoutMs / 1000))}s`;
  return `${Math.round(timeoutMs / 60000)} min`;
}

/** The shape a shop that never answered leaves behind. */
function emptyResult(source: ScraperSource, error: string, startedAt: number): ScraperResult {
  return {
    source,
    success: false,
    itemsCount: 0,
    products: [],
    error,
    durationMs: Date.now() - startedAt,
  };
}

export async function runGuarded(
  source: ScraperSource,
  walk: SiteWalk,
  timeoutMs: number,
): Promise<ScraperResult> {
  const startedAt = Date.now();
  const controller = new AbortController();

  // `.catch` before anything races it: whichever promise loses the race below
  // is still a promise nobody awaits, and an unguarded rejection there would
  // surface as an unhandled rejection once the run had moved on without it.
  const attempt = Promise.resolve()
    .then(() => walk(source, controller.signal))
    .catch((err) =>
      emptyResult(source, err instanceof Error ? err.message.split("\n")[0] : String(err), startedAt),
    );

  if (!Number.isFinite(timeoutMs)) return attempt;

  let timer: NodeJS.Timeout | undefined;
  const budget = describeBudget(timeoutMs);
  const watchdog = new Promise<ScraperResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Abandoned after ${budget}`));
      resolve({
        ...emptyResult(
          source,
          `Did not finish within its ${budget} budget and was abandoned so the remaining ` +
            `shops could run. Raise --site-timeout if this shop is simply large.`,
          startedAt,
        ),
        timedOut: true,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempt, watchdog]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk every selected shop in turn, guarded, collecting one result each.
 *
 * Sequential on purpose: these are small storefronts, and four concurrent full
 * walks is a burst none of them asked for. The isolation is what makes the
 * order irrelevant — a shop failing third does not shorten the list.
 */
export async function walkSites(
  sources: ScraperSource[],
  walk: SiteWalk,
  options: WalkOptions,
): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];

  for (const source of sources) {
    options.onStart?.(source);
    const result = await runGuarded(source, walk, options.timeoutMs);
    results.push(result);
    options.onResult?.(result);
  }

  return results;
}
