/**
 * A Postgres that behaves enough like Supabase to exercise the policies.
 *
 * RLS is on for every table and the policy surface runs across sixteen
 * migrations, and until now nothing exercised a single one of them. The
 * reason is ordinary: testing them needs a database, and the app's own test
 * suites deliberately need nothing.
 *
 * So this is its own runner, its own job in CI, and its own service container.
 * What it does not do is need a Supabase project: the migrations only depend
 * on four Supabase primitives — the `anon`, `authenticated` and `service_role`
 * roles, `auth.uid()`, and an `auth.users` table to hang foreign keys off —
 * and all four fit in the bootstrap below. A plain `postgres:17` container is
 * enough, which is what makes this runnable on every pull request rather than
 * against a shared project somebody has to keep clean.
 *
 * The simulation is the standard one: `set local role` plus
 * `request.jwt.claims`, which is exactly how PostgREST presents a request to
 * Postgres. The policies cannot tell the difference, because there is none —
 * `auth.uid()` reads that setting either way.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/**
 * Where the scratch database lives.
 *
 * Deliberately its own variable. Pointing this at a real project would run
 * every migration and then write test rows into it, so it does not fall back
 * to `DIRECT_URL` or `SUPABASE_DB_URL` however convenient that would be.
 */
export const RLS_DATABASE_URL = process.env.RLS_DATABASE_URL ?? "";

export const canRun = Boolean(RLS_DATABASE_URL);

export const SKIP_REASON =
  "RLS_DATABASE_URL is not set. These tests need a throwaway Postgres:\n" +
  "  docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:17\n" +
  "  RLS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres " +
  "npm run test:rls";

/**
 * The parts of Supabase the migrations reach for.
 *
 * `auth.uid()` is the whole game: every policy in the schema is written
 * against it, and it is nothing more than a read of the request's JWT claims.
 */
const BOOTSTRAP = `
  create extension if not exists "pgcrypto";
  create extension if not exists pg_trgm;

  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end $$;

  create schema if not exists auth;

  -- Foreign keys across the schema point at this.
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique
  );

  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      ),
      ''
    )::uuid
  $$;

  create or replace function auth.role() returns text
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
      'anon'
    )
  $$;

  create or replace function auth.email() returns text
  language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
`;

/**
 * Grants, which RLS does not replace.
 *
 * A policy decides which *rows* a role may touch; a grant decides whether it
 * may touch the table at all. Supabase issues these grants as part of its own
 * setup, so the migrations do not, and without them every query here would
 * fail with "permission denied" and every assertion would pass for the wrong
 * reason.
 */
const GRANTS = `
  grant select on all tables in schema public to anon, authenticated;
  grant insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
  grant all on all tables in schema public to service_role;
`;

export interface Harness {
  client: Client;
  /** Run `fn` as an anonymous visitor, rolled back afterwards. */
  asAnon<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  /** Run `fn` as a signed-in user, rolled back afterwards. */
  asUser<T>(userId: string, fn: (client: Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Every migration file, in the order `scripts/migrate.ts` would apply them. */
function migrations(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));
}

/**
 * Bring a scratch database to head and hand back a harness.
 *
 * The schema is rebuilt from nothing every run. A migration suite that only
 * works against a database somebody has already massaged is a migration suite
 * that will not work on the day it matters.
 */
export async function setup(): Promise<Harness> {
  const client = new Client({ connectionString: RLS_DATABASE_URL });
  await client.connect();

  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  await client.query(BOOTSTRAP);

  for (const { name, sql } of migrations()) {
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(
        `migration ${name} failed against the scratch database: ` +
          `${(error as Error).message}`,
      );
    }
  }

  await client.query(GRANTS);

  const run = async <T>(
    role: "anon" | "authenticated",
    userId: string | null,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> => {
    // Everything happens inside a transaction that is always rolled back, so
    // one test cannot see another's writes and the order they run in cannot
    // change an answer.
    await client.query("begin");
    try {
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role }),
      ]);
      return await fn(client);
    } finally {
      await client.query("rollback");
      await client.query("reset role");
    }
  };

  return {
    client,
    asAnon: (fn) => run("anon", null, fn),
    asUser: (userId, fn) => run("authenticated", userId, fn),
    close: () => client.end(),
  };
}

/* ------------------------------------------------------------- assertions */

/** Did this statement fail because a policy said no? */
export function isPolicyDenial(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? "";
  const code = (error as { code?: string })?.code ?? "";
  // 42501 insufficient_privilege — a policy refusal or a missing grant. Both
  // mean "you may not", which is what is being asserted.
  return code === "42501" || /violates row-level security|permission denied/i.test(message);
}

/**
 * The write must not happen: either it is refused outright, or it silently
 * affects nothing.
 *
 * Both are correct RLS outcomes and which one you get depends on whether the
 * policy failed a `using` clause or a `with check` clause — so an assertion
 * that only accepts a thrown error would pass and fail for reasons unrelated
 * to whether the data is safe.
 */
export async function expectWriteRefused(
  run: () => Promise<{ rowCount: number | null }>,
  what: string,
): Promise<void> {
  let rowCount: number | null = null;

  try {
    ({ rowCount } = await run());
  } catch (error) {
    if (isPolicyDenial(error)) return;
    throw new Error(`${what}: failed for a reason other than RLS — ${(error as Error).message}`);
  }

  if (rowCount && rowCount > 0) {
    throw new Error(`${what}: the write succeeded and changed ${rowCount} row(s).`);
  }
}
