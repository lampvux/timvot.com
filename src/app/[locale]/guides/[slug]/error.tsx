"use client";
import { useTranslations } from "next-intl";
export default function GuideError({ reset }: { reset: () => void }) {
  const t = useTranslations("guides");
  return <div className="page-shell py-16"><h1 className="font-display text-2xl font-bold">{t("loadError")}</h1><button onClick={reset} className="mt-5 min-h-11 rounded-md border border-line px-5">{t("retry")}</button></div>;
}
