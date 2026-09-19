import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real app, with no database.
 *
 * The unlock is `src/lib/data/seed.ts`. The repository returns the same shapes
 * from the seeded catalogue as it does from Supabase, and `npm run dev` is
 * documented to run with no environment variables at all — so clearing the two
 * `NEXT_PUBLIC_SUPABASE_*` variables gives a build that is deterministic,
 * offline, identical on every machine, and needs no secret in CI. There are no
 * fixtures to maintain, because the fixture is a committed file that the
 * guardrail suite already checks for drift.
 *
 * Two dimensions, both of which have caught things the desktop English run
 * would not:
 *
 *   locale   `vi` is the default and runs 20–30% longer than `en`. A control
 *            sized to its English string overflows in the language most of the
 *            audience reads.
 *   width    1280 and 400. The narrow one is where a `min-width` wider than
 *            the screen shows up.
 *
 * The `dev-smoke` project is separate and not part of `npm run test:e2e`,
 * because it needs `next dev` rather than a build: some Cache Components
 * validation runs only in development, so a route can build clean and still be
 * blocked from prerendering.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/** Whether the suite is driving its own server, or pointed at a deployment. */
const OWNS_SERVER = !process.env.E2E_BASE_URL;

/**
 * The environment the app under test runs in.
 *
 * Supabase is cleared rather than left unset, because a developer's `.env`
 * would otherwise be inherited and the run would silently become a test of
 * their database — passing or failing on data nobody else has.
 */
const SEED_ONLY_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  // Both providers are declared so the sign-in page renders its buttons and
  // `auth.spec.ts` can assert the list is honoured server-side.
  NEXT_PUBLIC_AUTH_PROVIDERS: "google,facebook",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  /** Each spec is independent; nothing shares a cookie jar or a database. */
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]]
    : [["list"]],

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    /** The catalogue is Vietnamese-first; so is the browser asking for it. */
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
      testIgnore: /dev-smoke\.spec\.ts/,
    },
    {
      // 400px is the width CLAUDE.md names, and the one where a side gutter
      // or a min-width mistake actually bites.
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 400, height: 860 } },
      testIgnore: /dev-smoke\.spec\.ts/,
    },
    {
      name: "dev-smoke",
      testMatch: /dev-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: OWNS_SERVER
    ? {
        // Built once, then served. `next start` rather than `next dev` so the
        // run exercises the prerendered shells a visitor actually gets.
        command:
          process.env.E2E_SKIP_BUILD === "1"
            ? `npx next start --port ${PORT}`
            : `npx next build && npx next start --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 15 * 60_000,
        stdout: "pipe",
        stderr: "pipe",
        env: SEED_ONLY_ENV,
      }
    : undefined,
});
