import { Suspense } from "react";
import { WatchPriceButton } from "@/components/watch-price";
import { getUser } from "@/lib/supabase/server";

/**
 * The racket page's other `getUser()` — kept off the page's critical path for
 * the same reason as the account link.
 *
 * It used to sit in the detail page's `Promise.all` alongside the catalogue
 * read, so a spec sheet waited on a Supabase Auth round-trip before it could
 * render. Now the page prerenders and this button resolves behind it.
 *
 * SECURITY. `signedIn` decides whether the click goes to `/sign-in` or
 * attempts the write. It is not what authorises the write: `WatchPriceButton`
 * re-establishes the user with `supabase.auth.getUser()` before upserting, and
 * the `watchlist` RLS policy is the real gate. Keep it that way.
 */

async function ResolvedWatchPrice({ variantId }: { variantId: string }) {
  const user = await getUser();
  return <WatchPriceButton variantId={variantId} signedIn={Boolean(user)} />;
}

export function WatchPriceSlot({ variantId }: { variantId: string }) {
  return (
    <Suspense
      // Same button, same box — only the click destination differs, so nothing
      // moves when the real one arrives.
      fallback={<WatchPriceButton variantId={variantId} signedIn={false} />}
    >
      <ResolvedWatchPrice variantId={variantId} />
    </Suspense>
  );
}
