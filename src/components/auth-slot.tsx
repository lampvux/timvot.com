import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/ds/primitives";
import { AccountMenu } from "@/components/account-menu";
import { createClient, getUser } from "@/lib/supabase/server";

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
 */

/** Rendered identically by the fallback and the resolved state, so the 44px
 *  target never moves — only the destination changes. */
async function AccountLink({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("nav");
  const tc = await getTranslations("common");

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
  const user = await getUser();
  if (!user) return <AccountLink signedIn={false} />;

  const supabase = await createClient();
  const { data: profile } = supabase
    ? await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const email = user.email ?? "";
  const displayName =
    profile?.display_name ||
    String(user.user_metadata?.display_name ?? "").trim() ||
    email;

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
