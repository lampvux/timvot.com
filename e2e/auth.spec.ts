import { at, expect, LOCALES, test, visit } from "./fixtures";

/**
 * The auth surface is deliberately small, and keeping it small is a testable
 * property rather than a note in a document.
 *
 * Browsing, comparing and the Finder require no account. Only the watchlist,
 * price alerts and reviews do. A page that starts asking for a sign-in to read
 * the catalogue has changed the product, and it should not be able to do that
 * quietly.
 */

/** Everything a visitor may do without an account. */
const OPEN_TO_EVERYONE = [
  "/rackets",
  "/rackets/yonex/astrox-99-pro",
  "/compare",
  "/finder",
  "/deals",
  "/strings",
  "/sellers",
  "/guides",
  "/methodology",
];

for (const locale of LOCALES) {
  test.describe(`auth surface (${locale})`, () => {
    test("browsing, comparing and the Finder need no account", async ({
      request,
      baseURL,
    }) => {
      const gated: string[] = [];

      for (const route of OPEN_TO_EVERYONE) {
        const path = at(locale, route);
        const response = await request.get(new URL(path, baseURL).toString(), {
          maxRedirects: 0,
        });

        const location = response.headers()["location"] ?? "";
        if (response.status() >= 300 && /sign-in/.test(location)) {
          gated.push(path);
        }
        expect(response.status(), `${path} answered ${response.status()}`).toBeLessThan(
          400,
        );
      }

      expect(
        gated,
        `${gated.join(", ")} now redirects to sign-in. Browsing, comparing ` +
          `and the Finder require no account — keep it that way.`,
      ).toEqual([]);
    });

    test("the sign-in page renders and is accessible", async ({ page }) => {
      await visit(page, at(locale, "/sign-in"));

      // Scoped to `main`: the header carries its own search form, and on
      // mobile that one is hidden, so `form` alone finds the wrong element
      // and then fails because it is invisible.
      await expect(page.locator("main form").first()).toBeVisible();
    });

    test("the sign-up page renders and is accessible", async ({ page }) => {
      await visit(page, at(locale, "/sign-up"));
    });

    test("every auth input is labelled", async ({ page }) => {
      // An unlabelled password field is the most common critical violation in
      // any sign-in form, and axe catches it — this names it explicitly so the
      // failure says which field.
      await page.goto(at(locale, "/sign-in"));
      await page.waitForLoadState("load");

      const unlabelled = await page.locator("input:not([type=hidden])").evaluateAll(
        (nodes) =>
          nodes
            .filter((node) => {
              const input = node as HTMLInputElement;
              if (input.getAttribute("aria-label")) return false;
              if (input.getAttribute("aria-labelledby")) return false;
              if (input.id && document.querySelector(`label[for="${input.id}"]`))
                return false;
              return !input.closest("label");
            })
            .map((node) => (node as HTMLInputElement).name || (node as HTMLInputElement).type),
      );

      expect(unlabelled, `unlabelled: ${unlabelled.join(", ")}`).toEqual([]);
    });

    test("the password field is a password field", async ({ page }) => {
      await page.goto(at(locale, "/sign-in"));
      await page.waitForLoadState("load");

      const password = page.locator('input[type="password"]');
      expect(await password.count()).toBeGreaterThan(0);
    });

    test("only the configured OAuth providers are offered", async ({ page }) => {
      // The buttons render from NEXT_PUBLIC_AUTH_PROVIDERS, and the list is
      // re-checked server-side in signInWithProvider. The browser half is what
      // this asserts; the server half is a unit test.
      await page.goto(at(locale, "/sign-in"));
      await page.waitForLoadState("load");

      const body = (await page.locator("main").innerText()).toLowerCase();

      // The e2e environment declares google and facebook.
      for (const offered of ["google", "facebook"]) {
        expect(body, `${offered} is configured but not offered`).toContain(offered);
      }

      for (const absent of ["github", "apple", "twitter", "discord"]) {
        expect(
          body,
          `${absent} is offered but not in NEXT_PUBLIC_AUTH_PROVIDERS`,
        ).not.toContain(absent);
      }
    });

    test("a signed-out visitor gets a signed-out shell, not a wait", async ({ page }) => {
      // Per-user chrome lives in a leaf behind Suspense, rendering a
      // signed-out shell as the fallback. If it moved into the layout, every
      // route in the app would block on Supabase Auth before its first byte.
      const response = await page.goto(at(locale, "/rackets"));
      expect(response?.status()).toBeLessThan(400);

      const html = (await response?.text()) ?? "";
      expect(
        html.length,
        "the first response carried no shell at all",
      ).toBeGreaterThan(1000);
    });
  });
}

test.describe("protected routes", () => {
  test("the account page does not leak another visitor's data", async ({
    request,
    baseURL,
  }) => {
    // With no session, /account either redirects to sign-in or renders a
    // signed-out state. What it may never do is render somebody's watchlist.
    const response = await request.get(new URL("/vi/account", baseURL).toString(), {
      maxRedirects: 0,
    });

    if (response.status() >= 300 && response.status() < 400) {
      expect(response.headers()["location"] ?? "").toMatch(/sign-in|\/vi/);
      return;
    }

    const html = await response.text();
    expect(html).not.toMatch(/@[\w.-]+\.\w+/);
  });

  test("the seller dashboard is not open to an anonymous visitor", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(
      new URL("/vi/seller/dashboard", baseURL).toString(),
      { maxRedirects: 0 },
    );

    const redirected = response.status() >= 300 && response.status() < 400;
    const location = response.headers()["location"] ?? "";

    if (redirected) {
      expect(location).toMatch(/sign-in|seller|\/vi/);
      return;
    }

    // Rendering is allowed only if it renders a prompt, not a dashboard.
    const html = (await response.text()).toLowerCase();
    expect(
      /qty_available|service_role|seller_id/.test(html),
      "the anonymous seller dashboard rendered listing internals",
    ).toBe(false);
  });
});
