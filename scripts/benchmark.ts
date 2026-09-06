/**
 * What the catalogue's hot paths actually cost.
 *
 *   npx tsx scripts/benchmark.ts                     # every scenario, 5 runs each
 *   npx tsx scripts/benchmark.ts --runs=10
 *   npx tsx scripts/benchmark.ts --only=catalogue    # substring match on the name
 *   npx tsx scripts/benchmark.ts --explain           # print query plans for SQL scenarios
 *   npx tsx scripts/benchmark.ts --markdown          # emit a table for a step summary
 *   npx tsx scripts/benchmark.ts --json=bench.json   # machine-readable, for diffing runs
 *
 * This exists because the read path's costs are invisible from the app. A page
 * renders, and nothing on screen says whether it moved 40 KB or 40 MB, or
 * whether the work was in Postgres, in PostgREST, or in the enrich loop. Every
 * performance rule in CLAUDE.md was written after one of those turned out to
 * be the answer, and the next one should be decided from a number rather than
 * from a guess.
 *
 * Three layers are measured separately, because they are fixed by different
 * things:
 *
 *   sql        the query itself, over a direct postgres:// connection. This is
 *              the floor — no PostgREST, no JSON shaping, no 1000-row paging.
 *              `--explain` prints the plan, which is what says whether an index
 *              is missing or a sort is spilling to disk.
 *   postgrest  the same read as the app issues it, through supabase-js. The gap
 *              between this and `sql` is transport, JSON encoding, and the
 *              round trips `selectAll` needs to get past `db-max-rows`.
 *   js         the work after the rows land: grouping, `enrich`, Court Score,
 *              filtering, sorting. Uses the real `court-score.ts`, so a
 *              coefficient change shows up here rather than being modelled.
 *
 * Scenarios are grouped `snapshot:`, `detail:`, `catalogue:` and `deals:`. Where
 * a scenario has a `today` and a `proposed` form, both run, so the table shows
 * the size of the prize rather than only the size of the problem.
 */

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./scraper/env";
import { courtScore } from "../src/lib/court-score";
import { balanceTypeOf } from "../src/lib/format";
import {
  mapOffer,
  mapPricePoint,
  mapRacket,
  mapReview,
  RACKET_SELECT,
} from "../src/lib/data/mappers";
import type {
  Offer,
  PricePoint,
  Racket,
  RacketWithMarket,
  Review,
} from "../src/lib/types";

/* ----------------------------------------------------------------- options */

interface Options {
  runs: number;
  only: string | null;
  explain: boolean;
  markdown: boolean;
  json: string | null;
}

function parseArgs(): Options {
  const flags: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value === undefined ? true : value;
  }
  const runs = Number(flags.runs);
  return {
    runs: Number.isFinite(runs) && runs > 0 ? Math.floor(runs) : 5,
    only: typeof flags.only === "string" ? flags.only : null,
    explain: Boolean(flags.explain),
    markdown: Boolean(flags.markdown),
    json: typeof flags.json === "string" ? flags.json : null,
  };
}

/* ------------------------------------------------------------- connections */

/**
 * A direct connection, for the `sql` layer and for `EXPLAIN`.
 *
 * Same credential order as `scripts/migrate.ts`, and the same reason a
 * service-role key is not one of them: it authenticates against PostgREST,
 * which cannot answer `explain`.
 */
async function connectSql() {
  const url =
    process.env.DIRECT_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL;
  if (!url) return null;

  const pg = await import("pg");
  const client = new pg.default.Client({
    connectionString: url,
    // Supabase's pooler presents a certificate for the pooler host rather than
    // the project host. Verification is not what this script is for.
    ssl: { rejectUnauthorized: false },
    application_name: "shuttlecraft-benchmark",
  });
  await client.connect();
  return client;
}

function connectPostgrest(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ---------------------------------------------------------------- timing */

type Layer = "sql" | "postgrest" | "js";

interface Result {
  name: string;
  layer: Layer;
  /** `today` is what the app does now; `proposed` is the alternative. */
  variant: "today" | "proposed" | "n/a";
  ms: number[];
  rows: number;
  bytes: number;
  note?: string;
  skipped?: string;
}

const results: Result[] = [];

/** Rough wire size. `JSON.stringify` is what PostgREST actually sends, so this
 *  is closer to the transfer bill than any row count is. */
function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

/**
 * Run `fn` `runs` times and keep every duration.
 *
 * The first call is discarded when there is more than one run: a cold
 * connection, a cold plan cache and a cold page cache measure the pool's
 * warm-up, not the query. What the app sees on a busy server is the warm case.
 */
async function measure<T>(
  name: string,
  layer: Layer,
  variant: Result["variant"],
  runs: number,
  fn: () => Promise<{ rows: number; payload: unknown; note?: string }>,
): Promise<T | undefined> {
  const ms: number[] = [];
  let rows = 0;
  let bytes = 0;
  let note: string | undefined;

  try {
    const total = runs > 1 ? runs + 1 : runs;
    for (let i = 0; i < total; i++) {
      const started = performance.now();
      const out = await fn();
      const elapsed = performance.now() - started;
      if (i === 0 && total > runs) continue; // discard the warm-up
      ms.push(elapsed);
      rows = out.rows;
      bytes = sizeOf(out.payload);
      note = out.note;
    }
    results.push({ name, layer, variant, ms, rows, bytes, note });
  } catch (error) {
    results.push({
      name,
      layer,
      variant,
      ms: [],
      rows: 0,
      bytes: 0,
      skipped: error instanceof Error ? error.message.slice(0, 120) : "failed",
    });
  }
  return undefined;
}

/* ------------------------------------------------------------ sql helpers */

type SqlClient = Awaited<ReturnType<typeof connectSql>>;

/** `EXPLAIN (ANALYZE, BUFFERS)` as a single indented block. */
async function explain(client: NonNullable<SqlClient>, sql: string, params: unknown[] = []) {
  const { rows } = await client.query(
    `explain (analyze, buffers, format text) ${sql}`,
    params as never[],
  );
  return rows.map((r) => `    ${(r as Record<string, string>)["QUERY PLAN"]}`).join("\n");
}

/* -------------------------------------------------------------- scenarios */

/**
 * The filter set the table is measured against.
 *
 * Deliberately a realistic combination rather than the cheapest one: a brand
 * and a flex narrow the result, a balance band is a range predicate over a
 * derived value, and a weight class has to reach `racket_variants`. A benchmark
 * that only measured the unfiltered first page would say the read path is fine.
 */
const FILTER = {
  brandSlugs: ["yonex", "victor"],
  flexes: ["stiff", "extra-stiff"],
  /** `balanceTypeOf`'s "even" band (EVEN_BAND_MIN_MM/EVEN_BAND_MAX_MM in
   *  types.ts), as the range predicate SQL would use. */
  balanceMin: 285,
  balanceMax: 295,
  weightClasses: ["4U", "5U"],
  pageSize: 24,
};

/** Kept out of `FILTER` so the filtered and searched scenarios stay separable —
 *  a text predicate and a facet predicate reach different indexes. */
const SEARCH_TERM = "astrox";

/**
 * The catalogue page, done entirely in Postgres, against the schema as it
 * stands today.
 *
 * Nothing here is materialised: the lowest live price is aggregated on the fly
 * and the ordering falls back to `release_year` because Court Score is a
 * TypeScript function and does not exist as a column. That is the point of
 * measuring it — if this is fast enough, the derived columns are not needed;
 * if it is not, this is the number that says so.
 */
const CATALOGUE_PAGE_SQL = `
  with filtered as (
    select
      r.id,
      r.release_year,
      coalesce(
        (
          select min(o.price)
          from offers o
          where o.racket_id = r.id and o.status = 'live' and o.qty_available > 0
        ),
        r.msrp
      ) as effective_price
    from rackets r
    join brands b on b.id = r.brand_id
    where ($1::text[] is null or b.slug = any($1))
      and ($2::text[] is null or r.shaft_flex::text = any($2))
      and r.balance_point_mm between $3 and $4
      and exists (
        select 1 from racket_variants v
        where v.racket_id = r.id and v.weight_class::text = any($5)
      )
      -- Matched against brand and model together, the same text the in-memory
      -- path builds, so the two scenarios count the same rows.
      and ($8::text is null or (b.name || ' ' || r.name) ilike '%' || $8 || '%')
  )
  select f.id, f.effective_price, count(*) over () as total
  from filtered f
  order by f.effective_price asc, f.id
  limit $6 offset $7
`;

/** The same shape a detail page needs, as four targeted reads rather than the
 *  whole catalogue. */
const DETAIL_SQL = `
  select
    r.*,
    (select json_agg(v) from racket_variants v where v.racket_id = r.id) as variants,
    (select json_agg(o) from offers o where o.racket_id = r.id and o.status = 'live') as offers,
    (select json_agg(rv) from reviews rv where rv.racket_id = r.id and rv.status = 'published') as reviews
  from rackets r
  where r.id = $1
`;

/* ------------------------------------------------------------------- main */

async function main() {
  loadEnv();
  const options = parseArgs();
  const wanted = (name: string) =>
    !options.only || name.toLowerCase().includes(options.only.toLowerCase());

  const sql = await connectSql();
  const rest = connectPostgrest();

  if (!sql && !rest) {
    console.error(
      "No credentials. Set DIRECT_URL (or SUPABASE_DB_URL) for the sql layer, " +
        "and NEXT_PUBLIC_SUPABASE_URL plus a key for the postgrest layer.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nShuttlecraft read-path benchmark — ${options.runs} run(s) per scenario` +
      `${options.runs > 1 ? ", first discarded as warm-up" : ""}\n` +
      `  sql layer:       ${sql ? "connected" : "skipped (no DIRECT_URL)"}\n` +
      `  postgrest layer: ${rest ? "connected" : "skipped (no keys)"}\n`,
  );

  /* ------------------------------------------------------- scale first */

  // Every `sql` row below includes one round trip to the database region. From
  // a laptop that is most of the number; from a Vercel function in the same
  // region it is single-digit milliseconds. Measure it once so the rest of the
  // table can be read as "this much latency, plus this much work".
  if (sql) {
    await measure("baseline:round trip (select 1)", "sql", "n/a", options.runs, async () => {
      const { rows } = await sql.query("select 1 as one");
      return { rows: rows.length, payload: null, note: "subtract from every sql row" };
    });
  }

  if (sql) {
    const { rows } = await sql.query(`
      select
        (select count(*) from rackets)        as rackets,
        (select count(*) from racket_variants) as variants,
        (select count(*) from offers)          as offers,
        (select count(*) from price_points)    as price_points,
        (select count(*) from reviews)         as reviews,
        (select count(*) from racket_images)   as images
    `);
    const scale = rows[0] as Record<string, string>;
    console.log(
      "Catalogue scale: " +
        Object.entries(scale)
          .map(([k, v]) => `${k} ${Number(v).toLocaleString("en-US")}`)
          .join(" · ") +
        "\n",
    );
  }

  /* ------------------------------------------- snapshot: the whole read */

  // Every uncached render pays this. `loadSnapshot` reads seven tables in
  // full, and five of them are past PostgREST's 1000-row cap, so this is also
  // where `selectAll`'s round trips show up.
  let snapshotRackets: Racket[] = [];
  let snapshotOffers: Offer[] = [];
  let snapshotReviews: Review[] = [];
  let snapshotHistory: PricePoint[] = [];

  if (rest && wanted("snapshot")) {
    const PAGE = 1000;
    /** `equals` is the one predicate the snapshot read uses (`status`), passed
     *  as a pair rather than a callback so the builder's types stay intact. */
    const selectAll = async (
      table: string,
      select: string,
      order: string[],
      equals?: [column: string, value: string],
    ) => {
      const all: unknown[] = [];
      let trips = 0;
      for (let from = 0; ; from += PAGE) {
        let q = rest.from(table).select(select);
        if (equals) q = q.eq(equals[0], equals[1]);
        for (const column of order) q = q.order(column);
        const { data, error } = await q.range(from, from + PAGE - 1);
        trips++;
        if (error) throw new Error(`${table}: ${error.message}`);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      return { all, trips };
    };

    await measure("snapshot:rackets (+variants +images)", "postgrest", "today", options.runs, async () => {
      const { all, trips } = await selectAll("rackets", RACKET_SELECT, ["id"]);
      snapshotRackets = all.map((r) => mapRacket(r as never));
      return { rows: all.length, payload: all, note: `${trips} round trips` };
    });

    await measure("snapshot:offers (live)", "postgrest", "today", options.runs, async () => {
      const { all, trips } = await selectAll("offers", "*", ["id"], ["status", "live"]);
      snapshotOffers = all.map((o) => mapOffer(o as never));
      return { rows: all.length, payload: all, note: `${trips} round trips` };
    });

    await measure("snapshot:price_points", "postgrest", "today", options.runs, async () => {
      const { all, trips } = await selectAll("price_points", "*", ["observed_on", "id"]);
      snapshotHistory = all.map((p) => mapPricePoint(p as never));
      return { rows: all.length, payload: all, note: `${trips} round trips` };
    });

    await measure("snapshot:reviews (published)", "postgrest", "today", options.runs, async () => {
      const { all, trips } = await selectAll("reviews", "*", ["id"], ["status", "published"]);
      snapshotReviews = all.map((r) => mapReview(r as never));
      return { rows: all.length, payload: all, note: `${trips} round trips` };
    });
  }

  /* ----------------------------------------- js: the index and enrich */

  // The part no database tuning touches. `loadIndex` is React `cache`, which
  // is per request — so this runs again on every render that is not a full
  // page cache hit.
  if (snapshotRackets.length && wanted("enrich")) {
    await measure("enrich:index build + Court Score", "js", "today", options.runs, async () => {
      const offersByRacket = new Map<string, Offer[]>();
      for (const offer of snapshotOffers) {
        const list = offersByRacket.get(offer.racketId);
        if (list) list.push(offer);
        else offersByRacket.set(offer.racketId, [offer]);
      }
      const reviewsByRacket = new Map<string, Review[]>();
      for (const review of snapshotReviews) {
        const list = reviewsByRacket.get(review.racketId);
        if (list) list.push(review);
        else reviewsByRacket.set(review.racketId, [review]);
      }
      const historyByVariant = new Map<string, PricePoint[]>();
      for (const point of snapshotHistory) {
        const list = historyByVariant.get(point.variantId);
        if (list) list.push(point);
        else historyByVariant.set(point.variantId, [point]);
      }
      for (const points of historyByVariant.values())
        points.sort((a, b) => a.observedOn.localeCompare(b.observedOn));

      const enriched: RacketWithMarket[] = snapshotRackets.map((racket) => {
        const liveOffers = (offersByRacket.get(racket.id) ?? []).filter(
          (o) => o.qtyAvailable > 0,
        );
        const racketReviews = reviewsByRacket.get(racket.id) ?? [];
        const history = racket.variants
          .flatMap((v) => historyByVariant.get(v.id) ?? [])
          .sort((a, b) => a.observedOn.localeCompare(b.observedOn));
        const score = courtScore(racket, racketReviews);
        return {
          ...racket,
          balanceType: balanceTypeOf(racket.balancePointMm),
          spec: score.spec,
          player: score.player,
          reviewCount: racketReviews.length,
          courtScore: score.total,
          specScore: score.specScore,
          lowestPrice: liveOffers.length
            ? Math.min(...liveOffers.map((o) => o.price))
            : null,
          sellerCount: new Set(liveOffers.map((o) => o.sellerId)).size,
          history,
        };
      });

      return {
        rows: enriched.length,
        payload: null,
        note: "per request, not cached across them",
      };
    });

    // What the catalogue page then does to that array, per request.
    const matchesFacets = (r: Racket) =>
      FILTER.brandSlugs.includes(r.brandSlug) &&
      FILTER.flexes.includes(r.shaftFlex) &&
      balanceTypeOf(r.balancePointMm) === "even" &&
      r.variants.some((v) => FILTER.weightClasses.includes(v.weightClass));

    await measure("catalogue:filter + sort + slice (in memory)", "js", "today", options.runs, async () => {
      const matched = snapshotRackets.filter(matchesFacets);
      const sorted = [...matched].sort((a, b) => a.msrp - b.msrp);
      return {
        rows: sorted.slice(0, FILTER.pageSize).length,
        payload: null,
        note: `${matched.length} matched of ${snapshotRackets.length} scanned`,
      };
    });

    await measure("catalogue:text search (in memory)", "js", "today", options.runs, async () => {
      const matched = snapshotRackets.filter((r) =>
        `${r.brandName} ${r.name}`.toLowerCase().includes(SEARCH_TERM),
      );
      return {
        rows: Math.min(matched.length, FILTER.pageSize),
        payload: null,
        note: `${matched.length} matched of ${snapshotRackets.length} scanned`,
      };
    });
  }

  /* ------------------------------------------------- catalogue: the page */

  /* ------------------------------- the read path the app actually uses */

  // `racket_market` through PostgREST, exactly as `catalog-page.ts` issues it:
  // predicates, ordering, `count: 'exact'` and one page's range. This is the
  // row to compare against the four `snapshot:` rows above — same page of the
  // same catalogue, both measured end to end.
  if (rest && wanted("catalogue")) {
    await measure("catalogue:page 1 filtered (racket_market, PostgREST)", "postgrest", "proposed", options.runs, async () => {
      const { data, error, count } = await rest
        .from("racket_market")
        .select(
          "id,brand_slug,shaft_flex,balance_type,weight_classes,effective_price," +
            "lowest_price,seller_count,court_score,spec_score,review_count,popular_rank",
          { count: "exact" },
        )
        .in("brand_slug", FILTER.brandSlugs)
        .in("shaft_flex", FILTER.flexes)
        .overlaps("weight_classes", FILTER.weightClasses)
        .order("popular_rank", { ascending: true })
        .order("court_score", { ascending: false, nullsFirst: false })
        .order("spec_score", { ascending: false })
        .order("id")
        .range(0, FILTER.pageSize - 1);
      if (error) throw new Error(error.message);
      return {
        rows: data?.length ?? 0,
        payload: data,
        note: `${count} total matches`,
      };
    });

    // The second request the page makes: full rows for the 24 ids it just got.
    // The ids are resolved once, outside the timed function, so this measures
    // the hydrate alone rather than two round trips.
    const { data: idRows } = await rest
      .from("racket_market")
      .select("id")
      .order("popular_rank")
      .order("id")
      .range(0, FILTER.pageSize - 1);
    const pageIds = (idRows ?? []).map((r) => (r as { id: string }).id);

    await measure("catalogue:hydrate 24 rackets (PostgREST)", "postgrest", "proposed", options.runs, async () => {
      const { data, error } = await rest
        .from("rackets")
        .select(RACKET_SELECT)
        .in("id", pageIds);
      if (error) throw new Error(error.message);
      return { rows: data?.length ?? 0, payload: data, note: "one round trip" };
    });

    // The facet read, which is its own cache entry keyed on the filters alone.
    await measure("catalogue:facet columns (racket_market, PostgREST)", "postgrest", "proposed", options.runs, async () => {
      const { data, error } = await rest
        .from("racket_market")
        .select("brand_slug,shaft_flex,balance_type,weight_classes")
        .order("id")
        .range(0, 999);
      if (error) throw new Error(error.message);
      return {
        rows: data?.length ?? 0,
        payload: data,
        note: "first page of the facet scan",
      };
    });
  }

  if (sql && wanted("catalogue")) {
    const params = [
      FILTER.brandSlugs,
      FILTER.flexes,
      FILTER.balanceMin,
      FILTER.balanceMax,
      FILTER.weightClasses,
      FILTER.pageSize,
      0,
      null,
    ];

    await measure("catalogue:page 1 filtered (SQL, live aggregate)", "sql", "proposed", options.runs, async () => {
      const { rows } = await sql.query(CATALOGUE_PAGE_SQL, params as never[]);
      const total = rows.length ? Number((rows[0] as Record<string, string>).total) : 0;
      return { rows: rows.length, payload: rows, note: `${total} total matches` };
    });

    await measure("catalogue:text search (SQL, ilike)", "sql", "proposed", options.runs, async () => {
      const searched = [null, null, 260, 320, ["2U", "3U", "4U", "5U"], FILTER.pageSize, 0, SEARCH_TERM];
      const { rows } = await sql.query(CATALOGUE_PAGE_SQL, searched as never[]);
      const total = rows.length ? Number((rows[0] as Record<string, string>).total) : 0;
      return { rows: rows.length, payload: rows, note: `${total} total matches` };
    });

    // Deep pages are where offset pagination degrades: Postgres still walks
    // every row it skips. If this is much slower than page 1, keyset
    // pagination is the answer rather than a bigger index.
    await measure("catalogue:page 60 filtered (SQL, live aggregate)", "sql", "proposed", options.runs, async () => {
      const deep = [...params];
      deep[6] = 59 * FILTER.pageSize;
      const { rows } = await sql.query(CATALOGUE_PAGE_SQL, deep as never[]);
      return { rows: rows.length, payload: rows };
    });

    await measure("catalogue:unfiltered count", "sql", "proposed", options.runs, async () => {
      const { rows } = await sql.query("select count(*)::int as n from rackets");
      return { rows: 1, payload: rows };
    });

    // Facet counts, as four grouped queries instead of four full scans in JS.
    await measure("catalogue:facet counts (SQL, 4 groups)", "sql", "proposed", options.runs, async () => {
      const { rows } = await sql.query(`
        select b.slug, count(*)::int as n
        from rackets r join brands b on b.id = r.brand_id
        group by b.slug
        union all
        select r.shaft_flex::text, count(*)::int
        from rackets r group by r.shaft_flex
        union all
        select case
          when r.balance_point_mm < 285 then 'head-light'
          when r.balance_point_mm > 294 then 'head-heavy'
          else 'even' end, count(*)::int
        from rackets r group by 1
        union all
        select v.weight_class::text, count(distinct v.racket_id)::int
        from racket_variants v group by v.weight_class
      `);
      return { rows: rows.length, payload: rows };
    });

    if (options.explain) {
      console.log("\n--- EXPLAIN: catalogue page 1 filtered ---");
      console.log(await explain(sql, CATALOGUE_PAGE_SQL, params));
    }
  }

  /* ---------------------------------------------------- detail: one racket */

  if (sql && wanted("detail")) {
    const { rows: sample } = await sql.query(
      "select id from rackets order by id offset 1500 limit 1",
    );
    const racketId = (sample[0] as { id: string } | undefined)?.id;

    if (racketId) {
      await measure("detail:one racket + variants/offers/reviews", "sql", "proposed", options.runs, async () => {
        const { rows } = await sql.query(DETAIL_SQL, [racketId] as never[]);
        return { rows: rows.length, payload: rows };
      });

      await measure("detail:price history for one racket", "sql", "proposed", options.runs, async () => {
        const { rows } = await sql.query(
          `select p.* from price_points p
           join racket_variants v on v.id = p.variant_id
           where v.racket_id = $1
           order by p.observed_on`,
          [racketId] as never[],
        );
        return { rows: rows.length, payload: rows };
      });

      if (options.explain) {
        console.log("\n--- EXPLAIN: racket detail ---");
        console.log(await explain(sql, DETAIL_SQL, [racketId]));
      }
    }
  }

  /* ------------------------------------------------------------- deals */

  if (sql && wanted("deals")) {
    // The deals page compares each variant's latest price to its 30-day
    // median. In JS that is the whole price table; in SQL it is a window.
    // `percentile_cont` is an ordered-set aggregate and cannot take an OVER
    // clause, so the median is grouped first and joined to the latest price.
    await measure("deals:below 30-day median (SQL)", "sql", "proposed", options.runs, async () => {
      const { rows } = await sql.query(`
        with window_points as (
          select variant_id, price, observed_on
          from price_points
          where observed_on >= current_date - 30
        ),
        medians as (
          select variant_id,
                 percentile_cont(0.5) within group (order by price) as median_30
          from window_points
          group by variant_id
        ),
        latest as (
          select distinct on (variant_id) variant_id, price
          from window_points
          order by variant_id, observed_on desc
        )
        select l.variant_id, l.price as latest, m.median_30
        from latest l
        join medians m using (variant_id)
        where l.price < m.median_30
        order by (l.price - m.median_30) asc
        limit 60
      `);
      return { rows: rows.length, payload: rows };
    });
  }

  await sql?.end();

  /* ------------------------------------------------------------- report */

  report(results, options);
}

/* ------------------------------------------------------------- reporting */

function fmtMs(ms: number[]): string {
  if (ms.length === 0) return "—";
  const sorted = [...ms].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  return ms.length === 1
    ? `${p50.toFixed(0)}`
    : `${p50.toFixed(0)} / ${p95.toFixed(0)}`;
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function report(all: Result[], options: Options) {
  const rows = all.map((r) => ({
    scenario: r.name,
    layer: r.layer,
    variant: r.variant,
    ms: r.skipped ? "—" : fmtMs(r.ms),
    rows: r.skipped ? "—" : r.rows.toLocaleString("en-US"),
    payload: r.skipped ? "—" : fmtBytes(r.bytes),
    note: r.skipped ? `skipped: ${r.skipped}` : (r.note ?? ""),
  }));

  const headers = ["scenario", "layer", "variant", "p50/p95 ms", "rows", "payload", "note"];
  const keys = ["scenario", "layer", "variant", "ms", "rows", "payload", "note"] as const;
  const widths = keys.map((key, i) =>
    Math.max(headers[i].length, ...rows.map((r) => String(r[key]).length)),
  );

  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();

  console.log("");
  console.log(line(headers));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) console.log(line(keys.map((k) => String(row[k]))));
  console.log("");

  const totalToday = all
    .filter((r) => r.variant === "today" && !r.skipped)
    .reduce((sum, r) => sum + percentile([...r.ms].sort((a, b) => a - b), 0.5), 0);
  const bytesToday = all
    .filter((r) => r.variant === "today" && r.layer === "postgrest" && !r.skipped)
    .reduce((sum, r) => sum + r.bytes, 0);

  if (totalToday > 0) {
    console.log(
      `Today's uncached catalogue render: ~${totalToday.toFixed(0)} ms and ` +
        `${fmtBytes(bytesToday)} over the wire, to show ${FILTER.pageSize} cards.`,
    );
  }

  if (options.markdown) {
    const md = [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${keys.map((k) => String(r[k])).join(" | ")} |`),
    ].join("\n");
    console.log("\n" + md + "\n");
  }

  if (options.json) {
    writeFileSync(
      options.json,
      JSON.stringify({ at: new Date().toISOString(), results: all }, null, 2),
    );
    console.log(`Wrote ${options.json}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
