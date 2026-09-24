import { getReviewPage } from "@/lib/data/repository";

const RACKET_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
/** Far past any real racket, and a bound on the offset a URL can ask for. */
const MAX_PAGE = 1000;

/**
 * One page of a racket's reviews, fetched when a reader clicks for it.
 *
 * The CDN window is short on purpose: a review a reader just published has to
 * appear on page two within a minute, and `updateTag` only reaches the app's
 * own cache, not this header.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  if (!RACKET_ID.test(id) || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const reviews = await getReviewPage(id, page);
    return Response.json(
      { reviews },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return Response.json({ error: "Unable to load reviews" }, { status: 500 });
  }
}
