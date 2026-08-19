/**
 * A small robots.txt reader.
 *
 * The retailer scrapers do not use this: they walk four catalogues we already
 * know the shape of, through documented endpoints, at four requests in flight.
 * The manufacturer crawl is different. It fans out across a dozen third-party
 * origins nobody here has agreed anything with, so it asks each one what it is
 * allowed to fetch before it fetches it, and it caches the answer per origin so
 * the question costs one request per site per run.
 *
 * The parse is the standard one and no more: longest-match wins between Allow
 * and Disallow, `*` and `$` are honoured inside paths, and a `User-agent: *`
 * group applies when no group names us. `Crawl-delay` is read and handed back
 * so the caller can slow down to whatever the site asked for.
 *
 * When robots.txt cannot be fetched at all, the answer is "allowed". A site
 * that is down should not be indistinguishable from a site that said no.
 */

import { fetchWithRetry, HTML_HEADERS } from "./http";

interface RobotsRule {
  allow: boolean;
  /** Path pattern with `*` and a possible trailing `$`. */
  pattern: string;
  /** Specificity, used for longest-match resolution. */
  length: number;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelayMs: number;
  sitemaps: string[];
  /** False when robots.txt could not be read, so everything is permitted. */
  fetched: boolean;
}

const cache = new Map<string, Promise<RobotsPolicy>>();

const EMPTY: RobotsPolicy = { rules: [], crawlDelayMs: 0, sitemaps: [], fetched: false };

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const ua = userAgent.toLowerCase();

  // Group state. `groupApplies` tracks whether the agent list of the group we
  // are inside names us; consecutive User-agent lines form one group.
  let inGroup = false;
  let groupApplies = false;
  let sawStarGroup = false;

  const starRules: RobotsRule[] = [];
  const ourRules: RobotsRule[] = [];
  let starDelay = 0;
  let ourDelay = 0;
  const sitemaps: string[] = [];

  let currentIsStar = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // A directive line closes the previous group; another agent line extends it.
      if (inGroup) {
        groupApplies = false;
        currentIsStar = false;
        inGroup = false;
      }
      const agent = value.toLowerCase();
      if (agent === "*") {
        currentIsStar = true;
        sawStarGroup = true;
      } else if (ua.includes(agent)) {
        groupApplies = true;
      }
      continue;
    }

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    inGroup = true;
    const target = groupApplies ? ourRules : currentIsStar ? starRules : null;

    if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        if (groupApplies) ourDelay = seconds * 1000;
        else if (currentIsStar) starDelay = seconds * 1000;
      }
      continue;
    }

    if (field !== "allow" && field !== "disallow") continue;
    if (!target) continue;

    // "Disallow:" with an empty value means "nothing is disallowed" — it is not
    // a rule, and treating it as the pattern "" would match every path.
    if (field === "disallow" && value === "") continue;

    target.push({
      allow: field === "allow",
      pattern: value,
      length: value.replace(/\*/g, "").length,
    });
  }

  const rules = ourRules.length > 0 ? ourRules : sawStarGroup ? starRules : [];
  const crawlDelayMs = ourRules.length > 0 ? ourDelay : starDelay;

  return { rules, crawlDelayMs, sitemaps, fetched: true };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
}

export function isAllowed(policy: RobotsPolicy, url: string): boolean {
  if (!policy.fetched || policy.rules.length === 0) return true;

  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    return true;
  }

  // Longest match wins; Allow wins a tie, which is what every major crawler does.
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!matches(rule.pattern, path)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) {
      best = rule;
    }
  }

  return best ? best.allow : true;
}

/** Read and cache one origin's robots.txt. One request per origin per run. */
export function robotsFor(url: string, userAgent: string): Promise<RobotsPolicy> {
  const origin = originOf(url);
  if (!origin) return Promise.resolve(EMPTY);

  let pending = cache.get(origin);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetchWithRetry(`${origin}/robots.txt`, {
          headers: HTML_HEADERS,
          timeoutMs: 15000,
          retries: 1,
        });
        // 4xx means no robots.txt, which means no restrictions.
        if (!res.ok || !res.body) return EMPTY;
        return parseRobots(res.body, userAgent);
      } catch {
        return EMPTY;
      }
    })();
    cache.set(origin, pending);
  }
  return pending;
}
