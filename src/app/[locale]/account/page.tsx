import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  Button,
  ButtonLinkStyle,
  Card,
  EmptyState,
  Eyebrow,
} from "@/components/ds/primitives";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth-actions";
import { loadSnapshot } from "@/lib/data/repository";
import { formatDong } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title") };
}

interface WatchRow {
  variant_id: string;
  target_price: number | null;
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("account");
  const tc = await getTranslations("common");
  const ta = await getTranslations("auth");

  const user = await getUser();

  if (!user) {
    return (
      <div className="page-shell py-12 lg:py-20">
        <div className="mx-auto max-w-[420px]">
          <EmptyState
            title={ta("signInTitle")}
            body={ta("why")}
            action={
              <Link
                href="/sign-in"
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {tc("signIn")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = supabase
    ? await supabase
        .from("watchlist")
        .select("variant_id, target_price")
        .eq("user_id", user.id)
    : { data: [] as WatchRow[] };

  const snapshot = await loadSnapshot();
  const variants = new Map(
    snapshot.rackets.flatMap((racket) =>
      racket.variants.map((variant) => [variant.id, { racket, variant }] as const),
    ),
  );

  const watched = ((data ?? []) as WatchRow[])
    .map((row) => {
      const entry = variants.get(row.variant_id);
      return entry ? { ...entry, targetPrice: row.target_price } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <div className="page-shell py-8 lg:py-12">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <Eyebrow>{t("title")}</Eyebrow>
          <h1 className="display mt-1.5 text-[27px] text-primary lg:text-h1">
            {t("watchlist")}
          </h1>
          <p className="mt-1.5 font-mono text-[12px] text-tertiary">
            {t("signedInAs", { email: user.email ?? "" })}
          </p>
        </div>
        <form action={signOut} className="ml-auto">
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="secondary" size="md" iconLeft="LogOut">
            {tc("signOut")}
          </Button>
        </form>
      </div>

      <div className="mt-6">
        {watched.length === 0 ? (
          <EmptyState
            title={t("emptyWatchlist")}
            body={ta("why")}
            action={
              <Link
                href="/rackets"
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {tc("seeAll")}
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {watched.map(({ racket, variant, targetPrice }) => (
              <Card key={variant.id} padding="md" interactive>
                <Link
                  href={`/rackets/${racket.brandSlug}/${racket.slug}`}
                  className="block no-underline"
                >
                  <div className="text-caption text-tertiary">
                    {racket.brandName}
                  </div>
                  <div className="font-display text-h4 font-semibold text-primary">
                    {racket.name}
                  </div>
                  <div className="mt-1 font-mono text-[12px] tabular-nums text-tertiary">
                    {variant.weightClass} {variant.gripSize}
                  </div>
                  <div className="price mt-2.5 text-[17px] text-primary">
                    {formatDong(racket.msrp)}
                  </div>
                  {targetPrice !== null && (
                    <div className="mt-1 font-mono text-[11px] tabular-nums text-drop">
                      {t("targetPrice", { price: formatDong(targetPrice) })}
                    </div>
                  )}
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
