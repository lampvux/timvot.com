"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ds/primitives";
import { createClient } from "@/lib/supabase/client";

/**
 * Price alerts are the one place browsing stops being anonymous, so the
 * button says what it costs: signed-out users are sent to sign in rather than
 * shown a modal that fails after they fill it in.
 */
export function WatchPriceButton({
  variantId,
  signedIn,
  size = "lg",
}: {
  variantId: string;
  signedIn: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [watching, setWatching] = useState(false);

  const onClick = () => {
    if (!signedIn) {
      router.push("/sign-in");
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      if (!supabase) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("watchlist")
        .upsert(
          { user_id: user.id, variant_id: variantId },
          { onConflict: "user_id,variant_id" },
        );
      setWatching(true);
    });
  };

  return (
    <Button
      variant="secondary"
      size={size}
      iconLeft={watching ? "BellRing" : "Bell"}
      disabled={pending || watching}
      onClick={onClick}
    >
      {watching ? t("watchPrice") : t("setPriceAlert")}
    </Button>
  );
}
