import { Suspense } from "react";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/ds/primitives";
import { AccountMenu } from "@/components/account-menu";
import { createClient, getUser } from "@/lib/supabase/server";
import { hasAuthCookie } from "@/lib/supabase/cookies";
import {
  finishFunctionProfile,
  profileFunction,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";

/**
 * The one piece of the chrome that knows who is looking.
 *
 * It used to be a `getUser()` await in `[locale]/layout.tsx`, which cost the
 * whole app two things: `getUser` reads `cookies()`, so every route in the
 * tree became dynamic — a build generated 140 pages from
 * `generateStaticParams` and then served all of them on demand anyway — and
 * the Supabase Auth round-trip sat in front of the first byte of every page,
 * including pages with nothing user-specific on them.
 *
 * Isolating it here means the shell prerenders and only this link streams.
 *
 * SECURITY. What resolves here decides which link to paint and nothing else.
 * It must never gate data. Watchlist, price alerts, the seller dashboard and
 * `/account` each re-establish the user themselves, and RLS is the real gate
 * in Postgres. If you find yourself passing this value into a query, stop.
 *
 * That is also the licence for the cookie check below. A visitor with no
 * Supabase auth cookie has no session for `getUser()` to find, so asking
 * Supabase Auth in Singapore only buys the answer the cookie jar already
 * gave — and it bought it inside the streamed hole of every route in the app,
 * on the overwhelming majority of public traffic. `CLAUDE.md` permits reading
 * auth state optimistically from cookie presence *for display*, and painting
 * an icon is the whole job here. Anything that gates data still calls
 * `getUser()`, and this file still does the moment a cookie is present.
 */

/** Rendered identically by the fallback and the resolved state, so the 44px
 *  target never moves — only the destination changes. */
async function AccountLink({ signedIn }: { signedIn: boolean }) {
  const started = startFunctionProfile();
  const t = await getTranslations("nav");
  const tc = await getTranslations("common");

  finishFunctionProfile("component.AccountLink", started, { signedIn });

  return (
    <Link
      href={signedIn ? "/account" : "/sign-in"}
      aria-label={signedIn ? t("account") : tc("signIn")}
      className="grid size-11 place-items-center rounded-md text-ink-700
        transition-colors duration-[90ms] hover:bg-[var(--action-ghost-bg-hover)]"
    >
      <Icon name="UserRound" size="md" />
    </Link>
  );
}

async function ResolvedAccountLink() {
  const started = startFunctionProfile();

  const cookieStore = await cookies();
  if (!hasAuthCookie(cookieStore.getAll())) {
    finishFunctionProfile("component.ResolvedAccountLink", started, {
      signedIn: false,
      session: false,
    });
    return <AccountLink signedIn={false} />;
  }

  const user = await profileFunction("supabase.getUser.accountSlot", () => getUser());
  if (!user) {
    finishFunctionProfile("component.ResolvedAccountLink", started, {
      signedIn: false,
    });
    return <AccountLink signedIn={false} />;
  }

  const email = user.email ?? "";

  /**
   * The name is read from the token first and from `profiles` only if it is
   * not there.
   *
   * Those two are written together, always: `lib/profile-actions.ts` updates
   * the row and calls `auth.updateUser` in the same action, the admin console's
   * staff action does the same, and `20260817000000_init.sql` seeds the row
   * from `raw_user_meta_data` on sign-up. So the row cannot hold a newer name
   * than the token — and reading it anyway cost a second serial round trip to
   * Singapore on every route a signed-in visitor opened, after `getUser()` had
   * already returned the answer.
   *
   * Keep them written together. A writer that updates one and not the other
   * makes this stale, and the fallback below will not catch it because the
   * token's value is present, just old.
   */
  const claimedName = String(user.user_metadata?.display_name ?? "").trim();

  let displayName = claimedName || email;
  if (!claimedName) {
    const supabase = await createClient();
    const { data: profile } = supabase
      ? await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle()
      : { data: null };
    displayName = profile?.display_name || email;
  }

  finishFunctionProfile("component.ResolvedAccountLink", started, {
    signedIn: true,
  });
  return <AccountMenu email={email} displayName={displayName} />;
}

/**
 * Signed-out is the fallback because it is the safe guess: a signed-in visitor
 * who clicks in the streaming window lands on `/sign-in`, which sends them
 * straight back. The reverse — showing an account link to nobody — would look
 * like a bug.
 */
export function AccountSlot() {
  return (
    <Suspense fallback={<AccountLink signedIn={false} />}>
      <ResolvedAccountLink />
    </Suspense>
  );
}
