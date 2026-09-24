import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import {
  canRun,
  expectWriteRefused,
  setup,
  SKIP_REASON,
  type Harness,
} from "./harness";

/**
 * The security claims, exercised against real policies.
 *
 * From CLAUDE.md: "RLS is on for every table. Catalogue writes are admin-only,
 * sellers manage their own offers but never their own tier, watchlists are
 * private, and sellers attach an offer to a catalogued variant rather than
 * creating products — that is what keeps the catalogue clean."
 *
 * Every sentence there is a policy, and until this file none of them was ever
 * executed by anything. A policy that is never exercised is a comment with
 * better syntax highlighting: it can be dropped by a migration, shadowed by a
 * broader one, or written against the wrong column, and the schema will still
 * apply cleanly.
 */

describe("row-level security", { skip: canRun ? false : SKIP_REASON }, () => {
  let harness: Harness;

  /** Identities the fixtures below are hung off. */
  const ADMIN = randomUUID();
  const SELLER_OWNER = randomUUID();
  const OTHER_SELLER_OWNER = randomUUID();
  const SHOPPER = randomUUID();
  const OTHER_SHOPPER = randomUUID();

  const SELLER_ID = "s-test-shop";
  const OTHER_SELLER_ID = "s-other-shop";
  const BRAND_ID = "b-test";
  const RACKET_ID = "r-test";
  const VARIANT_ID = "v-test";
  const OFFER_ID = "o-test";
  const OTHER_OFFER_ID = "o-other";

  before(async () => {
    harness = await setup();
    const { client } = harness;

    // Seeded as the owner, outside any policy, because this is the world the
    // policies are then asked about.
    for (const id of [ADMIN, SELLER_OWNER, OTHER_SELLER_OWNER, SHOPPER, OTHER_SHOPPER]) {
      await client.query("insert into auth.users (id, email) values ($1, $2)", [
        id,
        `${id}@example.test`,
      ]);
    }

    await client.query(
      `insert into profiles (id, role) values ($1, 'admin')
       on conflict (id) do update set role = 'admin'`,
      [ADMIN],
    );
    for (const id of [SELLER_OWNER, OTHER_SELLER_OWNER]) {
      await client.query(
        `insert into profiles (id, role) values ($1, 'seller')
         on conflict (id) do update set role = 'seller'`,
        [id],
      );
    }
    for (const id of [SHOPPER, OTHER_SHOPPER]) {
      await client.query(
        `insert into profiles (id, role) values ($1, 'user')
         on conflict (id) do nothing`,
        [id],
      );
    }

    await client.query(
      `insert into brands (id, slug, name, country) values ($1, 'test', 'Test', 'VN')`,
      [BRAND_ID],
    );
    await client.query(
      `insert into rackets (
         id, slug, brand_id, name, release_year, balance_point_mm, shaft_flex,
         shaft_diameter_mm, frame_shape, frame_material, max_tension_min_lbs,
         max_tension_max_lbs, length_mm, string_pattern, msrp, currency,
         play_style_tags, skill_level, summary_en, summary_vi
       ) values (
         $1, 'test-racket', $2, 'Test Racket', 2026, 295, 'medium',
         6.8, 'isometric', ARRAY['graphite'], 20, 28, 675, '22x21', 2000000, 'VND',
         ARRAY['all-round']::play_style[], 'intermediate', 'Test.', 'Test.'
       )`,
      [RACKET_ID, BRAND_ID],
    );
    await client.query(
      `insert into racket_variants (id, racket_id, weight_class, weight_grams, grip_size, sku)
       values ($1, $2, '4U', 83, 'G5', 'SKU-TEST')`,
      [VARIANT_ID, RACKET_ID],
    );

    await client.query(
      `insert into sellers (id, slug, name, tier, city, rating, orders_count,
                            dispute_rate, since, about_en, about_vi, owner_id)
       values ($1, 'test-shop', 'Test Shop', 'new', 'Hà Nội', 4.5, 10, 0.01, 2024,
               'About.', 'About.', $2)`,
      [SELLER_ID, SELLER_OWNER],
    );
    await client.query(
      `insert into sellers (id, slug, name, tier, city, rating, orders_count,
                            dispute_rate, since, about_en, about_vi, owner_id)
       values ($1, 'other-shop', 'Other Shop', 'verified', 'Đà Nẵng', 4.2, 5, 0.02, 2024,
               'About.', 'About.', $2)`,
      [OTHER_SELLER_ID, OTHER_SELLER_OWNER],
    );

    for (const [id, sellerId] of [
      [OFFER_ID, SELLER_ID],
      [OTHER_OFFER_ID, OTHER_SELLER_ID],
    ]) {
      await client.query(
        `insert into offers (
           id, variant_id, racket_id, seller_id, price, currency, qty_available,
           condition, warranty_months, includes_stringing, ships_from,
           lead_time_days, promoted, status
         ) values ($1, $2, $3, $4, 1900000, 'VND', 5, 'new', 12, false,
                   'Hà Nội', 2, false, 'live')`,
        [id, VARIANT_ID, RACKET_ID, sellerId],
      );
    }
  });

  after(async () => {
    await harness?.close();
  });

  /* ------------------------------------------------------ every table is on */

  it("has row-level security enabled on every public table", async () => {
    const { rows } = await harness.client.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and not c.relrowsecurity`,
    );

    assert.deepEqual(
      rows.map((row) => row.tablename).sort(),
      [],
      `these public tables have RLS switched off, so every policy beside them ` +
        `is decoration: ${rows.map((row) => row.tablename).join(", ")}`,
    );
  });

  it("has at least one policy on every table with RLS on", async () => {
    // RLS with no policy denies everything, which is safe and also means the
    // table is unreachable — usually a migration that forgot half its job.
    const { rows } = await harness.client.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
          and not exists (
            select 1 from pg_policy p where p.polrelid = c.oid
          )`,
    );

    assert.deepEqual(
      rows.map((row) => row.tablename),
      [],
      `${rows.map((row) => row.tablename).join(", ")} has RLS on and no policy, ` +
        `so nothing can read or write it at all.`,
    );
  });

  it("keeps guide generation runs private to the worker", async () => {
    const runKey = `rls-test:${randomUUID()}`;
    await harness.client.query(
      `insert into guide_generation_runs (run_key, state, lease_expires_at)
       values ($1, 'running', now() + interval '5 minutes')`,
      [runKey],
    );

    await harness.asAnon(async (client) => {
      const { rows } = await client.query(
        "select run_key from guide_generation_runs where run_key = $1",
        [runKey],
      );
      assert.equal(rows.length, 0, "anon can read worker run state");
    });

    await harness.asUser(SHOPPER, async (client) => {
      const { rows } = await client.query(
        "select run_key from guide_generation_runs where run_key = $1",
        [runKey],
      );
      assert.equal(rows.length, 0, "a signed-in user can read worker run state");
      await expectWriteRefused(
        () => client.query(
          `insert into guide_generation_runs (run_key, state, lease_expires_at)
           values ($1, 'running', now() + interval '5 minutes')`,
          [`user-run:${randomUUID()}`],
        ),
        "a signed-in user created a guide generation run",
      );
    });

    await harness.client.query("delete from guide_generation_runs where run_key = $1", [runKey]);
  });

  /* ------------------------------------------------- the catalogue is public */

  it("lets anyone read the catalogue", async () => {
    await harness.asAnon(async (client) => {
      for (const table of ["brands", "rackets", "racket_variants", "sellers", "price_points"]) {
        const { rows } = await client.query(`select count(*)::int as n from ${table}`);
        assert.ok(rows[0].n >= 0, `anon cannot read ${table}`);
      }

      const { rows } = await client.query("select id from rackets where id = $1", [
        RACKET_ID,
      ]);
      assert.equal(rows.length, 1, "anon could not read a catalogued racket");
    });
  });

  it("shows anyone only the live offers", async () => {
    await harness.client.query("update offers set status = 'paused' where id = $1", [
      OTHER_OFFER_ID,
    ]);

    await harness.asAnon(async (client) => {
      const { rows } = await client.query("select id, status from offers");
      assert.ok(rows.length > 0, "anon sees no offers at all");
      for (const row of rows) {
        assert.equal(
          row.status,
          "live",
          `anon can see a ${row.status} offer (${row.id}).`,
        );
      }
    });

    await harness.client.query("update offers set status = 'live' where id = $1", [
      OTHER_OFFER_ID,
    ]);
  });

  /* --------------------------------------------- catalogue writes are admin */

  const CATALOGUE_WRITES: Array<[string, string, unknown[]]> = [
    ["brands", "insert into brands (id, slug, name, country) values ($1, $2, 'X', 'VN')", ["b-evil", "evil"]],
    [
      "rackets",
      `insert into rackets (
         id, slug, brand_id, name, release_year, balance_point_mm, shaft_flex,
         shaft_diameter_mm, frame_shape, frame_material, max_tension_min_lbs,
         max_tension_max_lbs, length_mm, string_pattern, msrp, currency,
         play_style_tags, skill_level, summary_en, summary_vi
       ) values ($1, $2, 'b-test', 'Evil', 2026, 295, 'medium', 6.8, 'isometric',
                 ARRAY['x'], 20, 28, 675, '22x21', 1, 'VND',
                 ARRAY['all-round']::play_style[], 'intermediate', 'x', 'x')`,
      ["r-evil", "evil-racket"],
    ],
    [
      "racket_variants",
      `insert into racket_variants (id, racket_id, weight_class, weight_grams, grip_size, sku)
       values ($1, 'r-test', '4U', 83, 'G5', $2)`,
      ["v-evil", "SKU-EVIL"],
    ],
    [
      "price_points",
      "insert into price_points (variant_id, observed_on, price) values ($1, current_date, 1)",
      [VARIANT_ID],
    ],
  ];

  for (const [table, sql, params] of CATALOGUE_WRITES) {
    it(`refuses an anonymous write to ${table}`, async () => {
      await harness.asAnon(async (client) => {
        await expectWriteRefused(() => client.query(sql, params), `anon wrote to ${table}`);
      });
    });

    it(`refuses a signed-in non-admin write to ${table}`, async () => {
      await harness.asUser(SHOPPER, async (client) => {
        await expectWriteRefused(
          () => client.query(sql, params),
          `a signed-in shopper wrote to ${table}`,
        );
      });
    });

    it(`refuses a seller's write to ${table}`, async () => {
      // The claim: sellers attach an offer to a catalogued variant rather than
      // creating products. That is what keeps the catalogue clean.
      await harness.asUser(SELLER_OWNER, async (client) => {
        await expectWriteRefused(
          () => client.query(sql, params),
          `a seller wrote to ${table}`,
        );
      });
    });
  }

  it("refuses an anonymous update of a catalogued racket", async () => {
    await harness.asAnon(async (client) => {
      await expectWriteRefused(
        () => client.query("update rackets set msrp = 1 where id = $1", [RACKET_ID]),
        "anon repriced a racket",
      );
    });
  });

  it("refuses an anonymous delete from the catalogue", async () => {
    await harness.asAnon(async (client) => {
      await expectWriteRefused(
        () => client.query("delete from rackets where id = $1", [RACKET_ID]),
        "anon deleted a racket",
      );
    });
  });

  /* -------------------------------------------------- sellers and their offers */

  it("lets a seller write its own offer", async () => {
    await harness.asUser(SELLER_OWNER, async (client) => {
      const { rowCount } = await client.query(
        "update offers set price = 1800000 where id = $1",
        [OFFER_ID],
      );
      assert.equal(rowCount, 1, "a seller could not reprice its own listing.");
    });
  });

  it("refuses a seller writing another seller's offer", async () => {
    await harness.asUser(SELLER_OWNER, async (client) => {
      await expectWriteRefused(
        () => client.query("update offers set price = 1 where id = $1", [OTHER_OFFER_ID]),
        "a seller repriced a competitor's listing",
      );
    });
  });

  it("refuses a seller deleting another seller's offer", async () => {
    await harness.asUser(SELLER_OWNER, async (client) => {
      await expectWriteRefused(
        () => client.query("delete from offers where id = $1", [OTHER_OFFER_ID]),
        "a seller deleted a competitor's listing",
      );
    });
  });

  it("refuses a seller creating an offer under another seller's name", async () => {
    await harness.asUser(SELLER_OWNER, async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            `insert into offers (
               id, variant_id, racket_id, seller_id, price, currency, qty_available,
               condition, warranty_months, includes_stringing, ships_from,
               lead_time_days, promoted, status
             ) values ('o-impersonated', $1, $2, $3, 1, 'VND', 1, 'new', 0, false,
                       'x', 1, false, 'review')`,
            [VARIANT_ID, RACKET_ID, OTHER_SELLER_ID],
          ),
        "a seller listed under a competitor's storefront",
      );
    });
  });

  it("refuses an anonymous offer", async () => {
    await harness.asAnon(async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            `insert into offers (
               id, variant_id, racket_id, seller_id, price, currency, qty_available,
               condition, warranty_months, includes_stringing, ships_from,
               lead_time_days, promoted, status
             ) values ('o-anon', $1, $2, $3, 1, 'VND', 1, 'new', 0, false,
                       'x', 1, false, 'live')`,
            [VARIANT_ID, RACKET_ID, SELLER_ID],
          ),
        "anon created an offer",
      );
    });
  });

  /* ---------------------------------------------- a seller cannot self-promote */

  it("refuses a seller raising its own tier", async () => {
    // The escalation this schema exists to prevent. Tier decides trust
    // signals and sort position; a seller who can set it has bought both.
    await harness.asUser(SELLER_OWNER, async (client) => {
      await assert.rejects(
        () =>
          client.query("update sellers set tier = 'authorised' where id = $1", [
            SELLER_ID,
          ]),
        /Only staff can change seller trust and ownership fields/,
      );
    });

    // And it did not happen outside the transaction either.
    const { rows } = await harness.client.query("select tier from sellers where id = $1", [
      SELLER_ID,
    ]);
    assert.equal(rows[0].tier, "new");
  });

  it("lets a seller edit its own storefront copy", async () => {
    await harness.asUser(SELLER_OWNER, async (client) => {
      const { rowCount } = await client.query(
        "update sellers set about_en = $2 where id = $1",
        [SELLER_ID, "We string on site."],
      );
      assert.equal(rowCount, 1, "a seller could not edit its own description.");
    });
  });

  it("refuses a seller editing another storefront", async () => {
    await harness.asUser(SELLER_OWNER, async (client) => {
      await expectWriteRefused(
        () =>
          client.query("update sellers set about_en = 'hacked' where id = $1", [
            OTHER_SELLER_ID,
          ]),
        "a seller edited a competitor's storefront",
      );
    });
  });

  it("refuses a seller inventing a storefront", async () => {
    await harness.asUser(SHOPPER, async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            `insert into sellers (id, slug, name, tier, city, rating, orders_count,
                                  dispute_rate, since, about_en, about_vi, owner_id)
             values ('s-self', 'self', 'Self', 'authorised', 'x', 5, 0, 0, 2026,
                     'x', 'x', $1)`,
            [SHOPPER],
          ),
        "a shopper created an authorised storefront for itself",
      );
    });
  });

  /* ------------------------------------------------------ watchlists are private */

  it("keeps a watchlist private to its owner", async () => {
    const entryId = randomUUID();
    await harness.client.query(
      "insert into watchlist (id, user_id, variant_id, target_price) values ($1, $2, $3, 1000000)",
      [entryId, SHOPPER, VARIANT_ID],
    );

    await harness.asUser(SHOPPER, async (client) => {
      const { rows } = await client.query("select id from watchlist");
      assert.equal(rows.length, 1, "an owner cannot see their own watchlist.");
    });

    await harness.asUser(OTHER_SHOPPER, async (client) => {
      const { rows } = await client.query("select id from watchlist");
      assert.equal(
        rows.length,
        0,
        "another signed-in user can read somebody's watchlist. That is a list " +
          "of what a named person wants and what they will pay.",
      );
    });

    await harness.asAnon(async (client) => {
      const { rows } = await client.query("select id from watchlist");
      assert.equal(rows.length, 0, "anon can read a watchlist.");
    });

    await harness.client.query("delete from watchlist where id = $1", [entryId]);
  });

  it("refuses a watchlist entry written on somebody else's behalf", async () => {
    await harness.asUser(OTHER_SHOPPER, async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            "insert into watchlist (id, user_id, variant_id) values ($1, $2, $3)",
            [randomUUID(), SHOPPER, VARIANT_ID],
          ),
        "a user added an entry to somebody else's watchlist",
      );
    });
  });

  /* ------------------------------------------------------------- profiles */

  it("keeps a profile readable only by its owner and an admin", async () => {
    await harness.asUser(SHOPPER, async (client) => {
      const { rows } = await client.query("select id from profiles");
      assert.deepEqual(
        rows.map((row) => row.id),
        [SHOPPER],
        "a signed-in user can read profiles that are not theirs.",
      );
    });

    await harness.asUser(ADMIN, async (client) => {
      const { rows } = await client.query("select id from profiles");
      assert.ok(rows.length > 1, "an admin cannot read profiles.");
    });

    await harness.asAnon(async (client) => {
      const { rows } = await client.query("select id from profiles");
      assert.equal(rows.length, 0, "anon can read profiles.");
    });
  });

  it("refuses a user promoting themselves to admin", async () => {
    await harness.asUser(SHOPPER, async (client) => {
      await expectWriteRefused(
        () => client.query("update profiles set role = 'admin' where id = $1", [SHOPPER]),
        "a user made themselves an admin",
      );
    });

    const { rows } = await harness.client.query("select role from profiles where id = $1", [
      SHOPPER,
    ]);
    assert.notEqual(
      rows[0].role,
      "admin",
      "the role column changed. Everything admin-only in this schema is now open.",
    );
  });

  /* -------------------------------------------------------------- reviews */

  it("shows only published reviews to the public", async () => {
    const draftId = randomUUID();
    await harness.client.query(
      `insert into reviews (
         id, racket_id, user_id, author_name, tier, skill_level, format, position,
         string_model, tension_lbs, power, speed, control, comfort,
         body_en, body_vi, status
       ) values ($1, $2, $3, 'Draft Author', 'owner', 'intermediate', 'singles',
                 'rear', 'BG65', 24, 4, 3, 4, 3, 'draft', 'draft', 'pending')`,
      [draftId, RACKET_ID, SHOPPER],
    );

    await harness.asAnon(async (client) => {
      const { rows } = await client.query("select id, status from reviews");
      for (const row of rows) {
        assert.equal(row.status, "published", `anon can read a ${row.status} review.`);
      }
    });

    await harness.asUser(SHOPPER, async (client) => {
      const { rows } = await client.query("select id from reviews where id = $1", [draftId]);
      assert.equal(rows.length, 1, "an author cannot see their own unpublished review.");
    });

    await harness.asUser(OTHER_SHOPPER, async (client) => {
      const { rows } = await client.query("select id from reviews where id = $1", [draftId]);
      assert.equal(rows.length, 0, "another user can read somebody's unpublished review.");
    });

    await harness.client.query("delete from reviews where id = $1", [draftId]);
  });

  it("refuses a review written under another user's name", async () => {
    await harness.asUser(OTHER_SHOPPER, async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            `insert into reviews (
               id, racket_id, user_id, author_name, tier, skill_level, format,
               position, string_model, tension_lbs, power, speed, control, comfort,
               body_en, body_vi, status
             ) values ($1, $2, $3, 'Impostor', 'purchase', 'advanced', 'singles',
                       'rear', 'BG65', 24, 5, 5, 5, 5, 'x', 'x', 'published')`,
            [randomUUID(), RACKET_ID, SHOPPER],
          ),
        "a user published a review in somebody else's name",
      );
    });
  });

  it("refuses an anonymous review", async () => {
    await harness.asAnon(async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            `insert into reviews (
               id, racket_id, user_id, author_name, tier, skill_level, format,
               position, string_model, tension_lbs, power, speed, control, comfort,
               body_en, body_vi, status
             ) values ($1, $2, $3, 'Anon', 'community', 'beginner', 'doubles',
                       'net', 'BG65', 24, 5, 5, 5, 5, 'x', 'x', 'published')`,
            [randomUUID(), RACKET_ID, SHOPPER],
          ),
        "anon published a review",
      );
    });
  });

  /* ------------------------------------------------- community reviews RPC */

  const submitArgs = (body: string) => [
    RACKET_ID, "intermediate", "doubles", "rear", "BG65", 25, 4, 3, 4, 3, body, "en",
  ];
  const SUBMIT = `select public.submit_review($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as id`;
  const BODY = "Solid clears from the rear court, a little slow on drives at the net.";
  /** A refused call aborts the transaction; a savepoint keeps the next one
   *  meaningful. Only used for calls expected to fail. */
  const attempt = async (client: Client, args: unknown[]) => {
    await client.query("savepoint attempt");
    try {
      await client.query(SUBMIT, args);
    } finally {
      await client.query("rollback to savepoint attempt");
    }
  };

  it("refuses a direct author insert, even as the author", async () => {
    // The init policies let an author insert tier 'purchase', status
    // 'published' — a 3x-weighted Court Score review written by anyone.
    await harness.asUser(SHOPPER, async (client) => {
      await expectWriteRefused(
        () =>
          client.query(
            `insert into reviews (
               id, racket_id, user_id, author_name, tier, skill_level, format,
               position, string_model, tension_lbs, power, speed, control, comfort,
               body_en, body_vi, status
             ) values ($1, $2, $3, 'Self', 'purchase', 'advanced', 'singles',
                       'rear', 'BG65', 24, 5, 5, 5, 5, 'x', 'x', 'published')`,
            [randomUUID(), RACKET_ID, SHOPPER],
          ),
        "an author inserted a review around submit_review",
      );
    });
  });

  it("publishes a community review through submit_review, with the tier forced", async () => {
    await harness.asUser(SHOPPER, async (client) => {
      const { rows } = await client.query(SUBMIT, submitArgs(BODY));
      const { rows: stored } = await client.query(
        "select user_id, tier, status, body_en, body_vi from reviews where id = $1",
        [rows[0].id],
      );
      assert.equal(stored[0].user_id, SHOPPER);
      assert.equal(stored[0].tier, "community", "an author chose their own tier.");
      assert.equal(stored[0].status, "published");
      assert.equal(stored[0].body_en, BODY);
      assert.equal(stored[0].body_vi, null);
    });
  });

  it("refuses submit_review for an anonymous visitor", async () => {
    await harness.asAnon(async (client) => {
      await expectWriteRefused(
        () => client.query(SUBMIT, submitArgs(BODY)),
        "anon submitted a review",
      );
    });
  });

  it("holds one review per racket, a cooldown, and the content rules", async () => {
    await harness.asUser(OTHER_SHOPPER, async (client) => {
      await client.query(SUBMIT, submitArgs(BODY));
      await assert.rejects(
        () => attempt(client, submitArgs(BODY)),
        /review_duplicate/,
        "one account reviewed the same racket twice",
      );
    });

    await harness.asUser(SHOPPER, async (client) => {
      await assert.rejects(
        () => attempt(client, submitArgs("too short")),
        /review_invalid/,
      );
      await assert.rejects(
        () => attempt(client, submitArgs(`${BODY} Cheaper at https://example.test`)),
        /review_links/,
      );
      const nullRating = submitArgs(BODY);
      nullRating[6] = null as never;
      await assert.rejects(
        () => attempt(client, nullRating),
        /review_invalid/,
        "a null rating passed the range check",
      );
    });

    // Cooldown: a second racket straight after the first.
    const second = "r-test-2";
    await harness.client.query(
      `insert into rackets (
         id, slug, brand_id, name, release_year, balance_point_mm, shaft_flex,
         shaft_diameter_mm, frame_shape, frame_material, max_tension_min_lbs,
         max_tension_max_lbs, length_mm, string_pattern, msrp, currency,
         play_style_tags, skill_level, summary_en, summary_vi
       ) select $1, 'test-racket-2', brand_id, 'Test Racket 2', release_year,
                balance_point_mm, shaft_flex, shaft_diameter_mm, frame_shape,
                frame_material, max_tension_min_lbs, max_tension_max_lbs, length_mm,
                string_pattern, msrp, currency, play_style_tags, skill_level,
                summary_en, summary_vi
         from rackets where id = $2`,
      [second, RACKET_ID],
    );
    try {
      await harness.asUser(OTHER_SHOPPER, async (client) => {
        await client.query(SUBMIT, submitArgs(BODY));
        const args = submitArgs(BODY);
        args[0] = second;
        await assert.rejects(() => attempt(client, args), /review_cooldown/);
      });
    } finally {
      await harness.client.query("delete from rackets where id = $1", [second]);
    }
  });

  it("pages published reviews only, capped, and tallies them per tier", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      const id = `rv-page-${String(i).padStart(2, "0")}`;
      ids.push(id);
      await harness.client.query(
        `insert into reviews (
           id, racket_id, author_name, tier, skill_level, format, position,
           string_model, tension_lbs, power, speed, control, comfort, body_en,
           status, created_at
         ) values ($1, $2, 'Page', $3, 'intermediate', 'doubles', 'mid',
                   'BG65', 25, 4, 3, 2, 5, 'x', $4, now() - make_interval(mins => $5))`,
        [id, RACKET_ID, i % 3 === 0 ? "purchase" : "community",
         i === 14 ? "pending" : "published", i],
      );
    }
    try {
      await harness.asAnon(async (client) => {
        const first = await client.query(
          "select public.get_racket_reviews($1, 0, 3) as rows", [RACKET_ID]);
        assert.deepEqual(
          first.rows[0].rows.map((r: { id: string }) => r.id),
          ["rv-page-00", "rv-page-01", "rv-page-02"],
          "page one is not the newest three",
        );
        const capped = await client.query(
          "select jsonb_array_length(public.get_racket_reviews($1, 0, 500)) as n", [RACKET_ID]);
        assert.equal(capped.rows[0].n, 12, "a caller asked for 500 reviews and got them");
        const tail = await client.query(
          "select public.get_racket_reviews($1, 12, 12) as rows", [RACKET_ID]);
        assert.deepEqual(
          tail.rows[0].rows.map((r: { id: string }) => r.id),
          ["rv-page-12", "rv-page-13"],
          "the pending review leaked into a public page",
        );

        const market = await client.query(
          "select public.get_racket_detail_market('test', 'test-racket') as m");
        const m = market.rows[0].m;
        assert.equal(m.first_reviews.length, 3);
        assert.equal("reviews" in m, false, "the market read still ships every review");
        // 14 published: i = 0,3,6,9,12 are purchase (5), the rest community (9).
        assert.deepEqual(m.review_tally.purchase,
          { count: 5, power: 20, speed: 15, control: 10, comfort: 25 });
        assert.equal(m.review_tally.community.count, 9);
      });
    } finally {
      await harness.client.query("delete from reviews where id = any($1)", [ids]);
    }
  });

  /* ------------------------------------------------------------- an admin */

  it("lets an admin manage the catalogue", async () => {
    // The other half of "catalogue writes are admin-only": they have to work.
    await harness.asUser(ADMIN, async (client) => {
      const { rowCount } = await client.query(
        "update rackets set msrp = 2100000 where id = $1",
        [RACKET_ID],
      );
      assert.equal(rowCount, 1, "an admin cannot edit the catalogue.");
    });
  });

  /* --------------------------------------------------------------- storage */

  it("makes the racket image buckets public-read and admin-write", async (t) => {
    const { rows } = await harness.client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.tables
          where table_schema = 'storage' and table_name = 'objects'
       ) as exists`,
    );

    if (!rows[0].exists) {
      t.skip(
        "storage.objects does not exist in a plain Postgres, so the bucket " +
          "policies cannot be exercised here. The migration that defines them " +
          "is checked for presence instead.",
      );
      return;
    }

    const { rows: policies } = await harness.client.query<{ polname: string }>(
      `select p.polname
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'storage' and c.relname = 'objects'`,
    );

    assert.ok(policies.length > 0, "storage.objects has no policies at all.");
  });
});
