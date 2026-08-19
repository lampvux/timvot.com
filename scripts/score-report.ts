/** Prints the Court Score for every seeded racket. Sanity check for the
 *  scoring model — run it after touching src/lib/court-score.ts. */
import { rackets, reviews } from "../src/lib/data/seed";
import { courtScore } from "../src/lib/court-score";

const rows = rackets
  .map((racket) => {
    const racketReviews = reviews.filter((r) => r.racketId === racket.id);
    const score = courtScore(racket, racketReviews);
    return { racket, score, count: racketReviews.length };
  })
  .sort(
    (a, b) =>
      (b.score.total ?? b.score.specScore) - (a.score.total ?? a.score.specScore),
  );

console.log("tot spec plyr   n   msrp  P    S    C    F    racket");
for (const { racket, score, count } of rows) {
  const a = score.spec;
  console.log(
    String(score.total).padStart(3),
    String(score.specScore).padStart(4),
    String(score.playerScore ?? "--").padStart(4),
    String(count).padStart(3),
    (racket.msrp / 1e6).toFixed(2).padStart(6),
    a.power.toFixed(1).padStart(4),
    a.speed.toFixed(1).padStart(4),
    a.control.toFixed(1).padStart(4),
    a.comfort.toFixed(1).padStart(4),
    "",
    racket.name,
  );
}
