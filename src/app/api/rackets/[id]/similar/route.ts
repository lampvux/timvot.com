import { getSimilarRackets } from "@/lib/data/repository";
import {
  finishFunctionProfile,
  profileFunction,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";

const RACKET_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const started = startFunctionProfile();
  const { id } = await params;
  if (!RACKET_ID.test(id)) {
    return Response.json({ error: "Invalid racket id" }, { status: 400 });
  }

  try {
    const rackets = await profileFunction(
      "repository.getSimilarRackets.lazy",
      () => getSimilarRackets(id, 3),
      { racketId: id },
    );
    finishFunctionProfile("route.similar.GET", started, {
      racketId: id,
      racketCount: rackets.length,
    });
    return Response.json(
      { rackets },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return Response.json({ error: "Unable to load similar rackets" }, { status: 500 });
  }
}
