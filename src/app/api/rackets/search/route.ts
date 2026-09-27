import type { NextRequest } from "next/server";
import { searchRackets } from "@/lib/data/repository";
import { modelMatch, searchTokens } from "@/lib/listing-check/match";

/**
 * Model suggestions for the listing check. At most eight rackets, bounded
 * query length, and no raw query in any log line — a buyer may paste post
 * text here.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const tokens = searchTokens(q);
  if (!tokens) {
    return Response.json({ error: "Query must be 2 to 60 characters" }, { status: 400 });
  }

  const candidates = await searchRackets(tokens);
  if (!candidates) {
    return Response.json({ error: "Search is unavailable" }, { status: 503 });
  }

  return Response.json(
    { match: modelMatch(q, candidates), candidates },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
