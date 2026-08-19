# Authentication setup

Shuttlecraft uses Supabase Auth with cookie sessions (`@supabase/ssr`). Three
sign-in methods are wired up: **email and password**, **Google** and **Facebook**.

An account is only ever needed for the watchlist, price alerts and reviews.
Browsing, comparing and the Finder need nothing, and that should stay true — do
not put a sign-in wall in front of the catalogue.

---

## How it fits together

```
  sign-in page                Supabase               provider
  ────────────                ────────               ────────
  email + password  ──────▶  signInWithPassword  ──▶  (none)
                                    │
                                    ▼  session cookie, done

  "Continue with Google"  ─▶  signInWithOAuth  ──▶  accounts.google.com
                                                          │
                                                          ▼
                             /auth/callback?code=…  ◀──────┘
                                    │
                                    ▼  exchangeCodeForSession → cookie
```

The provider secrets live **in the Supabase dashboard**, not in this repo.
Supabase is what talks to Google and Facebook; the app only ever talks to
Supabase. Nothing here needs a Google client secret in `.env`.

The pieces in the code:

| File | Role |
| ---- | ---- |
| `src/lib/supabase/config.ts` | Which providers to render, and the site URL OAuth returns to |
| `src/lib/auth-actions.ts` | `signIn`, `signUp`, `signInWithProvider`, `signOut` |
| `src/components/oauth-buttons.tsx` | The Google and Facebook buttons |
| `src/app/auth/callback/route.ts` | Exchanges the one-time code for a session |
| `src/proxy.ts` | Refreshes the session; **excludes `/auth`** (see below) |

> **`/auth` must stay out of the proxy matcher.** `localePrefix` is `"always"`,
> so next-intl redirects unprefixed paths — which sent `/auth/callback?code=…`
> to `/vi/auth/callback?code=…`, a route that does not exist. Every confirmation
> and OAuth redirect landed on a 404 with the one-time code already spent. If
> sign-in starts 404ing, check that matcher first.

---

## 1. Email and password

Works as soon as the Supabase keys are set. Nothing else to configure.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then in **Supabase → Authentication → URL Configuration**:

- **Site URL** — `http://localhost:3000` locally, your real domain in production.
- **Redirect URLs** — add `http://localhost:3000/auth/callback` and
  `https://your-domain.com/auth/callback`.

Sign-up sends a confirmation email whose link comes back through
`/auth/callback`. Until the address is confirmed, sign-in fails — that is
Supabase's **Confirm email** setting under Authentication → Providers → Email.
Turn it off there if you want sign-up to log people straight in, but leave it on
for anything public.

For local development the default Supabase SMTP is rate-limited to a handful of
messages an hour. Add your own SMTP under **Project Settings → Authentication →
SMTP Settings** before inviting anyone real.

---

## 2. Google

### a. Create the OAuth client

1. Go to <https://console.cloud.google.com>, create or pick a project.
2. **APIs & Services → OAuth consent screen.** Choose **External**, fill in the
   app name, support email and developer contact. While the app is in
   **Testing**, only accounts you list as test users can sign in — publish it
   when you are ready for the public.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - **Authorised JavaScript origins**:
     ```
     http://localhost:3000
     https://your-domain.com
     ```
   - **Authorised redirect URIs** — this is the *Supabase* callback, not yours:
     ```
     https://<ref>.supabase.co/auth/v1/callback
     ```
4. Copy the **Client ID** and **Client secret**.

> The redirect URI catches most people out. Google redirects to **Supabase**,
> and Supabase then redirects to your `/auth/callback`. Putting your own
> `/auth/callback` in Google's list produces `redirect_uri_mismatch`.

### b. Enable it in Supabase

**Authentication → Providers → Google** → toggle on, paste the Client ID and
Client secret, save.

### c. Turn the button on

```bash
NEXT_PUBLIC_AUTH_PROVIDERS=google
```

Restart `npm run dev` — this is a `NEXT_PUBLIC_` variable, so it is read at
build time and a running server will not pick it up.

---

## 3. Facebook

### a. Create the app

1. Go to <https://developers.facebook.com/apps>, **Create App**, choose
   **Authenticate and request data from users with Facebook Login** → **Consumer**.
2. Add the **Facebook Login** product.
3. **Facebook Login → Settings → Valid OAuth Redirect URIs**:
   ```
   https://<ref>.supabase.co/auth/v1/callback
   ```
   Again: Supabase's URL, not yours.
4. **App settings → Basic**: copy the **App ID** and **App secret**.
5. Still under Basic, set the **Privacy Policy URL** — Facebook will not let you
   leave Development mode without one.

### b. Enable it in Supabase

**Authentication → Providers → Facebook** → toggle on, paste the App ID as the
client ID and the App secret as the secret, save.

### c. Turn the button on

```bash
NEXT_PUBLIC_AUTH_PROVIDERS=google,facebook
```

> A Facebook app in **Development** mode only admits people with a role on the
> app (admin, developer, tester). Switch it to **Live** for public sign-in, which
> requires the privacy policy URL and the `email` permission — granted by default,
> but check it under App Review → Permissions if sign-in returns no address.

---

## 4. Verify

```bash
npm run dev
```

- `/vi/sign-in` and `/en/sign-in` should show the email form, and beneath a
  hairline labelled "hoặc tiếp tục với" / "or continue with", one button per
  provider in `NEXT_PUBLIC_AUTH_PROVIDERS`.
- No buttons at all means that variable is empty or the server was not restarted.
- Clicking a button should leave for the provider and come back signed in at
  `/vi/account`.

If a round trip fails, the callback forwards the provider's own reason to the
sign-in page rather than swallowing it:

| Message | Meaning |
| ------- | ------- |
| `Unsupported provider: provider is not enabled` | On in `NEXT_PUBLIC_AUTH_PROVIDERS`, off in the Supabase dashboard |
| `redirect_uri_mismatch` | The provider has the wrong redirect URI — it wants `https://<ref>.supabase.co/auth/v1/callback` |
| `missing_code` | Reached `/auth/callback` without a code, usually a stale or reused link |
| `config` | The Supabase keys are absent |

---

## Notes

**Profiles.** `handle_new_user()` in the init migration creates a row in
`profiles` for every new auth user, reading `display_name` from the sign-up
metadata. Google and Facebook supply `full_name` and `avatar_url` instead, so an
OAuth user gets a profile with a null display name until the trigger is taught
to read those keys — worth doing before the account page shows names.

**Account linking is off by default.** Someone who signs up with
`a@example.com` by email and later clicks "Continue with Google" on the same
address gets a *second* identity unless **Authentication → Providers → Allow
manual linking** is enabled. Decide this before launch; retrofitting a merge
across two user ids is unpleasant.

**Only add providers you have enabled.** `NEXT_PUBLIC_AUTH_PROVIDERS` controls
the buttons and nothing else. The list is validated server-side in
`signInWithProvider`, so a hand-crafted request naming a provider that is not on
the list is rejected rather than passed through to Supabase.
