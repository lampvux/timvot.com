import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ButtonLinkStyle,
  Card,
  EmptyState,
  Eyebrow,
  Icon,
  Tag,
} from "@/components/ds/primitives";
import { BalanceMini } from "@/components/ds/data";
import { CompareToggle } from "@/components/compare-tray";
import { FinderQuiz } from "@/components/finder-quiz";
import { getRackets } from "@/lib/data/repository";
import { BUDGET_RANGE, parseAnswers, runFinder } from "@/lib/finder";
import { BALANCE_MESSAGE_KEY, FLEX_MESSAGE_KEY, formatDong } from "@/lib/format";
import type { SearchParams } from "@/lib/filters";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "finder" });
  return { title: t("title") };
}

export default async function FinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("finder");
  const te = await getTranslations("enums");
  const tc = await getTranslations("common");

  const answers = parseAnswers(await searchParams);

  if (!answers) {
    return (
      <div className="page-shell py-10 lg:py-14">
        <div className="mx-auto max-w-[560px] pb-6">
          <h1 className="display text-[30px] text-primary lg:text-[40px]">
            {t("title")}
          </h1>
          <p className="mt-3 text-body-lg text-secondary">{t("intro")}</p>
        </div>
        <FinderQuiz />
      </div>
    );
  }

  const rackets = await getRackets();
  const matches = runFinder(rackets, answers);

  // If nothing fits, say what one step of slack would give.
  const widerBudgets = Object.keys(BUDGET_RANGE) as (keyof typeof BUDGET_RANGE)[];
  const currentIndex = widerBudgets.indexOf(answers.budget);
  const nextBudget =
    widerBudgets[Math.min(widerBudgets.length - 1, currentIndex + 1)];
  const widerCount = runFinder(rackets, { ...answers, budget: nextBudget }).length;

  return (
    <div className="page-shell py-8 lg:py-12">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div>
          <Eyebrow>{t("title")}</Eyebrow>
          <h1 className="display mt-1.5 text-[27px] text-primary lg:text-h1">
            {t("resultsTitle", { count: matches.length })}
          </h1>
        </div>
        <Link
          href="/finder"
          className={ButtonLinkStyle({ variant: "secondary", size: "md" }) + " ml-auto"}
        >
          {t("startOver")}
        </Link>
      </div>

      {matches.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody", { count: widerCount })}
          action={
            <Link
              href={{ pathname: "/finder", query: { ...answers, budget: nextBudget } }}
              className={ButtonLinkStyle({ variant: "primary", size: "md" })}
            >
              {tc("apply")}
            </Link>
          }
        />
      ) : (
        <ol className="flex flex-col gap-4">
          {matches.map((match, index) => {
            const racket = match.racket;
            return (
              <li key={racket.id}>
                <Card padding="md">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="flex items-start gap-4">
                      <span className="font-display text-[27px] font-extrabold leading-none tabular-nums text-[var(--text-disabled)]">
                        {index + 1}
                      </span>
                      <span className="aspect-square w-20 shrink-0 rounded-md bg-sunken sm:w-24" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-caption text-tertiary">
                        {racket.brandName} · {racket.releaseYear}
                      </div>
                      <Link
                        href={`/rackets/${racket.brandSlug}/${racket.slug}`}
                        className="font-display text-h3 font-bold text-primary no-underline hover:text-brand"
                      >
                        {racket.name}
                      </Link>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Tag>{te(BALANCE_MESSAGE_KEY[racket.balanceType])}</Tag>
                        <Tag>{te(FLEX_MESSAGE_KEY[racket.shaftFlex])}</Tag>
                        <Tag mono>
                          {racket.courtScore === null
                            ? `${racket.specScore}/100 · spec`
                            : `${racket.courtScore}/100`}
                        </Tag>
                      </div>

                      {/* The explanation is the product. */}
                      <div className="mt-3 rounded-md bg-brand-soft px-3.5 py-2.5">
                        <Eyebrow className="!text-brand">
                          {t("whyMatched")}
                        </Eyebrow>
                        <p className="mt-1 text-body-sm text-ink-800">
                          {t(match.reason.key, match.reason.values)}
                        </p>
                      </div>

                      <div className="mt-3 max-w-[280px]">
                        <BalanceMini mm={racket.balancePointMm} />
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2.5 sm:items-end">
                      <span className="price text-[19px] text-primary">
                        {formatDong(racket.lowestPrice ?? racket.msrp)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-tertiary">
                        {tc("sellers", { count: racket.sellerCount })}
                      </span>
                      <CompareToggle
                        item={{
                          slug: racket.slug,
                          name: racket.name,
                          brand: racket.brandName,
                        }}
                      />
                      <Link
                        href={`/rackets/${racket.brandSlug}/${racket.slug}`}
                        className={ButtonLinkStyle({ variant: "ghost", size: "md" })}
                      >
                        {tc("view")}
                        <Icon name="ArrowRight" size="sm" />
                      </Link>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
