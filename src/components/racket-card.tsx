import { getTranslations } from "next-intl/server";
import {
  RacketCardView,
  type RacketCardProps,
} from "@/components/racket-card-view";
import {
  BALANCE_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  PLAY_STYLE_MESSAGE_KEY,
} from "@/lib/format";

/**
 * Server wrapper for the catalogue card. The synchronous card body is shared
 * with the three lazy client recommendations without turning every catalogue
 * card into a hydrated Client Component.
 */
export async function RacketCard({
  racket,
  compact,
  density = "default",
  mobileLayout = "stacked",
  priority = false,
}: RacketCardProps) {
  const [t, te, tr] = await Promise.all([
    getTranslations("common"),
    getTranslations("enums"),
    getTranslations("racket"),
  ]);

  return (
    <RacketCardView
      racket={racket}
      compact={compact}
      density={density}
      mobileLayout={mobileLayout}
      priority={priority}
      labels={{
        belowList: t("belowList"),
        sellers: t("sellers", { count: racket.sellerCount }),
        headLight: tr("headLight"),
        headHeavy: tr("headHeavy"),
        balance: te(BALANCE_MESSAGE_KEY[racket.balanceType]),
        flex: te(FLEX_MESSAGE_KEY[racket.shaftFlex]),
        playStyles: Object.fromEntries(
          racket.playStyleTags.map((style) => [
            style,
            te(PLAY_STYLE_MESSAGE_KEY[style]),
          ]),
        ),
      }}
    />
  );
}
