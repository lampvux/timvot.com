import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function GuideNotFound() {
  const t = await getTranslations("guides");
  return (
    <div className="page-shell py-16 lg:py-24">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 max-w-[24ch] font-display text-[30px] font-bold leading-tight text-primary lg:text-[42px]">
        {t("notFoundTitle")}
      </h1>
      <p className="mt-4 max-w-[58ch] leading-7 text-secondary">
        {t("notFoundDescription")}
      </p>
      <Link
        href="/guides"
        className="mt-7 inline-flex min-h-11 items-center rounded-md border border-line-strong px-5 font-semibold text-primary hover:bg-card"
      >
        {t("back")}
      </Link>
    </div>
  );
}
