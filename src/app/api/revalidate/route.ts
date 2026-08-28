import { revalidateTag } from "next/cache";
import { isCacheTag, SCRAPE_TAGS, type CacheTag } from "@/lib/data/tags";

/**
 * On-demand cache invalidation, for the scraper.
 *
 * The catalogue changes when `npm run scrape:sync` writes to Postgres, and
 * nothing about a page load should be what discovers that. This is the hook
 * the scraper calls when it finishes, so a price drop appears because it was
 * scraped rather than because a timer expired.
 *
 * It exists because time-based revalidation alone is a poor fit on Vercel
 * Hobby: cron jobs there are capped at once per day and fire anywhere inside a
 * 59-minute window, so a schedule cannot be the trigger. The `cacheLife`
 * windows in next.config.ts stay as the safety net for when this is not called
 * at all — a scrape run from a laptop with no network back to production, say.
 *
 * Auth is a shared secret compared in constant time. It is deliberately not a
 * Supabase session: the caller is a node script, not a person, and giving it a
 * user would mean giving that user rights it should not have.
 */

function authorised(request: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  // No secret configured means no remote invalidation, rather than an open
  // endpoint that anyone can use to evict the cache on a loop.
  if (!secret) return false;

  const offered = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!offered || offered.length !== secret.length) return false;

  // Constant time over equal-length strings, so a wrong secret cannot be
  // recovered a character at a time from response timings.
  let diff = 0;
  for (let i = 0; i < secret.length; i++)
    diff |= secret.charCodeAt(i) ^ offered.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) {
    // Same answer for "no secret set", "wrong secret" and "no header": none of
    // them should be distinguishable from outside.
    return Response.json({ revalidated: false }, { status: 401 });
  }

  let tags: CacheTag[] = SCRAPE_TAGS;

  try {
    const body = (await request.json()) as { tags?: unknown };
    if (Array.isArray(body.tags)) {
      const requested = body.tags.filter(
        (tag): tag is string => typeof tag === "string",
      );
      const unknown = requested.filter((tag) => !isCacheTag(tag));
      if (unknown.length) {
        // A typo here would otherwise revalidate nothing and report success —
        // the exact failure mode that makes a stale price look like a bug in
        // the scraper.
        return Response.json(
          { revalidated: false, error: `unknown tags: ${unknown.join(", ")}` },
          { status: 400 },
        );
      }
      if (requested.length) tags = requested.filter(isCacheTag);
    }
  } catch {
    // No body, or not JSON. Fall through to the scrape defaults.
  }

  // Stale-while-revalidate: readers keep getting the previous prices while the
  // new ones are fetched, rather than a queue of requests all waiting on the
  // same rebuild. `updateTag` is the read-your-own-writes alternative, but it
  // only works in a Server Action and this caller is a node script.
  for (const tag of tags) revalidateTag(tag, "max");

  return Response.json({ revalidated: true, tags, at: Date.now() });
}
