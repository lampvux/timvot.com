import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ButtonLinkStyle, EmptyState } from "@/components/ds/primitives";

export default async function NotFound() {
  const t = await getTranslations("catalog");
  const tn = await getTranslations("nav");

  return (
    <div className="page-shell py-16 lg:py-24">
      <div className="mx-auto max-w-[520px]">
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBodyNoSuggestion")}
          action={
            <Link
              href="/rackets"
              className={ButtonLinkStyle({ variant: "primary", size: "md" })}
            >
              {tn("rackets")}
            </Link>
          }
        />
      </div>
    </div>
  );
}
