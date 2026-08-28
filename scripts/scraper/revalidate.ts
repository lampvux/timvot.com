import { SCRAPE_TAGS } from "../../src/lib/data/tags";

/**
 * Tell the deployed app that the catalogue moved.
 *
 * A scrape writes prices into Postgres, but the app serves them from a
 * prerendered page — so without this the change waits out a `cacheLife`
 * window. On Vercel Hobby the usual alternative is not available: cron jobs
 * there run at most once a day and fire anywhere inside a 59-minute window, so
 * a schedule cannot be the trigger. The writer has to be.
 *
 * Configured by two env vars, both optional. With neither set this is a no-op
 * and says so — the common case for a scrape run against a local database,
 * where there is no deployment to notify.
 *
 *   REVALIDATE_URL     https://<your-app>/api/revalidate
 *   REVALIDATE_SECRET  the same value the deployment has
 *
 * Never fails the run. The scrape's job is to get correct rows into Postgres;
 * a cache that refreshes on its timer instead of immediately is a slower
 * update, not a wrong one, and it is not worth a non-zero exit code on an
 * unattended nightly.
 */
export async function revalidateCatalogue(
  tags: readonly string[] = SCRAPE_TAGS,
): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;

  if (!url || !secret) {
    console.log(
      "ℹ️  Not revalidating the deployed cache — set REVALIDATE_URL and " +
        "REVALIDATE_SECRET to have a scrape publish immediately.",
    );
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tags }),
      // An unattended run must not hang on a deployment that has gone away.
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(
        `⚠️  Revalidation returned ${response.status}. Prices are in Postgres; ` +
          `the site will pick them up when the cache window expires.`,
      );
      return;
    }

    console.log(`♻️  Revalidated: ${tags.join(", ")}`);
  } catch (error) {
    console.warn(
      `⚠️  Could not reach ${url} to revalidate ` +
        `(${error instanceof Error ? error.message : String(error)}). ` +
        `Prices are in Postgres; the site will pick them up on its own.`,
    );
  }
}
