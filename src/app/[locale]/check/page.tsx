import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  Badge,
  ButtonLinkStyle,
  Card,
  EmptyState,
  Eyebrow,
  Icon,
  type IconName,
} from "@/components/ds/primitives";
import { BalanceMini } from "@/components/ds/data";
import { CheckForm } from "@/components/check-form";
import { CopyButton } from "@/components/copy-button";
import { CheckSkeleton } from "@/components/skeletons";
import {
  getRacketCore,
  getRacketDetail,
  getSimilarRackets,
  isSampleCatalogue,
  priceClock,
} from "@/lib/data/repository";
import {
  CHECK_KEYS,
  checkQuery,
  parseCheckInput,
  shareQuery,
  type CheckInput,
} from "@/lib/listing-check/input";
import type { RacketCandidate } from "@/lib/listing-check/match";
import {
  INSPECTION_CHECKLIST,
  fitFor,
  needsInspection,
  questionsForSeller,
  type FitStatus,
  type Sentence,
} from "@/lib/listing-check/advice";
import {
  FRESH_HOURS,
  MIN_OBSERVATIONS,
  MIN_SELLERS,
  displayPrice,
  priceContext,
  type PriceContext,
  type PriceStatus,
} from "@/lib/price-context";
import {
  BALANCE_MESSAGE_KEY,
  CONDITION_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  formatAbsoluteDate,
  formatDong,
  variantCode,
} from "@/lib/format";
import type { SearchParams } from "@/lib/filters";
import type { Racket, RacketCardData, RacketVariant } from "@/lib/types";

/**
 * Check a listing found elsewhere — usually a Facebook group post.
 *
 * The shell prerenders; the form or the result streams behind Suspense
 * because both read the URL. Nothing is written anywhere: a check is a
 * function of its URL, which carries only what `parseCheckInput` allows.
 */

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "check" });
  const query = await searchParams;
  // A personalised result is not a page to index; the empty form is.
  const personal = CHECK_KEYS.some((key) => query[key] !== undefined);
  return {
    title: t("title"),
    description: t("metaDescription"),
    ...(personal && { robots: { index: false, follow: true } }),
  };
}

export default async function CheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={<CheckSkeleton />}>
      <CheckBody locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}

async function CheckBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<SearchParams>;
}) {
  setRequestLocale(locale);
  const t = await getTranslations("check");
  const query = await searchParams;
  const input = parseCheckInput(query);
  const editing = query.edit === "1";

  if (editing || (!input.model && !input.query)) {
    const racket = input.model
      ? await getRacketCore(input.model.brandSlug, input.model.slug)
      : null;
    return (
      <div className="page-shell py-8 lg:py-12">
        <div className="mx-auto max-w-[560px] pb-6">
          <h1 className="display text-[27px] text-primary lg:text-[40px]">{t("title")}</h1>
          <p className="mt-3 text-body-lg text-secondary">{t("intro")}</p>
        </div>
        <CheckForm
          initial={racket ? input : { ...input, model: null, variantId: null }}
          initialModel={racket ? toCandidate(racket) : null}
        />
      </div>
    );
  }

  if (!input.model) return <UnconfirmedResult input={input} />;

  const detail = await getRacketDetail(input.model.brandSlug, input.model.slug);
  if (!detail) {
    return (
      <div className="page-shell py-10">
        <EmptyState
          title={t("missingTitle")}
          body={t("missingBody")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/rackets" className={ButtonLinkStyle({ variant: "primary", size: "md" })}>
                {t("searchCatalogue")}
              </Link>
              <Link href="/check" className={ButtonLinkStyle({ variant: "secondary", size: "md" })}>
                {t("startAgain")}
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const { racket, offers } = detail;
  const variant = racket.variants.find((v) => v.id === input.variantId) ?? null;
  const checked: CheckInput = { ...input, variantId: variant?.id ?? null };

  const price = priceContext({
    offers,
    msrp: racket.msrp,
    variantId: variant?.id ?? null,
    condition: input.condition,
    askingPrice: input.priceVnd,
    now: priceClock(),
  });
  // A failed recommendation read must not cost the buyer the rest of the answer.
  const alternatives = await getSimilarRackets(racket.id, 3).catch(() => [] as RacketCardData[]);

  const fit = fitFor(racket, input.profile);
  const questions = questionsForSeller(input.condition, variant !== null);
  const sellerName = new Map(offers.map((offer) => [offer.id, offer.seller.name]));
  const variantById = new Map(racket.variants.map((v) => [v.id, v]));
  const editHref = { pathname: "/check", query: { ...checkQuery(checked), edit: "1" } };

  const [tc, te, tf] = await Promise.all([
    getTranslations("common"),
    getTranslations("enums"),
    getTranslations("checkForm"),
  ]);
  const title = `${racket.brandName} ${racket.name}`;
  const questionText = [
    title + (variant ? ` ${variantCode(variant.weightClass, variant.gripSize)}` : ""),
    ...questions.map((q, index) => `${index + 1}. ${t(q.key)}`),
  ].join("\n");

  return (
    <div className="page-shell py-6 lg:py-10">
      <div className="mx-auto flex max-w-[880px] flex-col gap-5">
        {isSampleCatalogue() && <SampleNotice text={t("sampleData")} />}

        {/* 1. Model and match confidence */}
        <section aria-labelledby="check-model">
          <Eyebrow>{t("modelEyebrow")}</Eyebrow>
          <h1 id="check-model" className="display mt-1.5 text-[24px] text-primary lg:text-h1">
            {racket.name}
          </h1>
          <div className="mt-1 text-caption text-tertiary">
            {racket.brandName} · {racket.releaseYear}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="brand" icon="CircleCheck">{t("modelConfirmed")}</Badge>
            {variant ? (
              <Badge tone="brand" icon="CircleCheck">
                {t("variantConfirmed", { variant: variantCode(variant.weightClass, variant.gripSize) })}
              </Badge>
            ) : (
              <Badge tone="caution" icon="CircleAlert">{t("variantUnconfirmed")}</Badge>
            )}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 2. Fit and tradeoffs */}
          <Section id="check-fit" title={t("fitTitle")}>
            <StatusBadge {...FIT_STATUS[fit.status]} label={t(FIT_STATUS[fit.status].key)} />
            {fit.status === "needs_profile" ? (
              <p className="mt-3 text-body-sm text-secondary">{t("fitNeedsProfileBody")}</p>
            ) : fit.reasons.length ? (
              <SentenceList t={t} items={fit.reasons} />
            ) : (
              <p className="mt-3 text-body-sm text-secondary">{t("fitNoReason")}</p>
            )}
            <div className="mt-4 rounded-md bg-sunken px-3.5 py-2.5">
              <Eyebrow>{t("tradeoffsTitle")}</Eyebrow>
              <SentenceList t={t} items={fit.tradeoffs} compact />
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="rounded-pill border border-line px-2.5 py-1 text-[12px] text-secondary">
                {te(BALANCE_MESSAGE_KEY[racket.balanceType])}
              </span>
              <span className="rounded-pill border border-line px-2.5 py-1 text-[12px] text-secondary">
                {te(FLEX_MESSAGE_KEY[racket.shaftFlex])}
              </span>
            </div>
            <div className="mt-3 max-w-[320px]">
              <BalanceMini mm={racket.balancePointMm} label={`${racket.balancePointMm} mm`} />
            </div>
            {fit.status === "needs_profile" && (
              <Link href={editHref} className="mt-4 inline-block text-body-sm font-semibold">
                {t("addProfile")}
              </Link>
            )}
          </Section>

          {/* 3. Price context */}
          <Section id="check-price" title={t("priceTitle")}>
            <StatusBadge {...PRICE_STATUS[price.status]} label={t(PRICE_STATUS[price.status].key)} />
            <PriceBody
              t={t}
              locale={locale}
              price={price}
              variantLabel={
                variant ? variantCode(variant.weightClass, variant.gripSize) : t("variantUnconfirmed")
              }
              conditionLabel={tf(CONDITION_KEY[input.condition])}
            />
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-line pt-3 text-body-sm">
              <dt className="text-secondary">{t("askingEntered")}</dt>
              <dd className="price text-right text-primary">
                {input.priceVnd === null ? "—" : formatDong(input.priceVnd)}
              </dd>
              <dt className="text-secondary">{t("currentOffer")}</dt>
              <dd className="price text-right text-primary">
                {price.currentOfferPrice === null ? "—" : formatDong(price.currentOfferPrice)}
              </dd>
              <dt className="text-secondary">{t("msrpLabel")}</dt>
              <dd className="price text-right text-tertiary">{formatDong(price.msrp)}</dd>
            </dl>
            {price.currentOfferPrice === null && (
              <p className="mt-2 text-caption text-tertiary">{t("noCurrentOffer")}</p>
            )}
            {price.evidence.length > 0 && (
              <div className="mt-4">
                <Eyebrow as="h3">{t("evidenceTitle")}</Eyebrow>
                <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                  {price.evidence.slice(0, 5).map((item) => {
                    const v = variantById.get(item.variantId);
                    return (
                      <li key={item.offerId} className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2">
                        <span className="min-w-0 truncate text-body-sm text-primary">
                          {sellerName.get(item.offerId)}
                        </span>
                        <span className="price text-right text-body-sm text-primary">
                          {formatDong(item.price)}
                        </span>
                        <span className="col-span-2 font-mono text-[11px] text-tertiary">
                          {v ? `${variantCode(v.weightClass, v.gripSize)} · ` : ""}
                          {te(CONDITION_MESSAGE_KEY[item.condition])} ·{" "}
                          {formatAbsoluteDate(item.observedAt, locale)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-caption text-tertiary">{t("evidenceSource")}</p>
              </div>
            )}
          </Section>
        </div>

        {/* 4. Seller questions — the main action */}
        <SellerQuestions t={t} questions={questions} copyText={questionText} />
        {needsInspection(input.condition) && <InspectionChecklist t={t} />}

        {/* 5. Alternatives */}
        <Section id="check-alternatives" title={t("alternativesTitle")}>
          {alternatives.length ? (
            <ul className="divide-y divide-line">
              {alternatives.map((alt) => {
                const altPrice = displayPrice(alt);
                return (
                  <li key={alt.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/rackets/${alt.brandSlug}/${alt.slug}`}
                        className="block truncate text-body-sm font-semibold text-primary no-underline hover:text-brand"
                      >
                        {alt.name}
                      </Link>
                      <span className="font-mono text-[11px] text-tertiary">
                        {alt.brandName} · {alt.balancePointMm} mm ·{" "}
                        {te(FLEX_MESSAGE_KEY[alt.shaftFlex])}
                      </span>
                    </div>
                    <span className="price shrink-0 text-body-sm text-primary">
                      {altPrice.kind === "msrp" && (
                        <span className="mr-1 font-mono text-[11px] text-tertiary">{tc("msrpPrefix")}</span>
                      )}
                      {formatDong(altPrice.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body-sm text-secondary">{t("noAlternatives")}</p>
          )}
        </Section>

        {/* 6. Secondary actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {alternatives.length > 0 && (
            <Link
              href={{
                pathname: "/compare",
                query: { ids: [racket.slug, ...alternatives.slice(0, 2).map((a) => a.slug)].join(",") },
              }}
              className={ButtonLinkStyle({ variant: "secondary", size: "lg" })}
            >
              <Icon name="GitCompare" size="md" />
              {t("compareWith")}
            </Link>
          )}
          <Link
            href={`/rackets/${racket.brandSlug}/${racket.slug}`}
            className={ButtonLinkStyle({ variant: "secondary", size: "lg" })}
          >
            {t("retailOffers")}
          </Link>
          <Link href={editHref} className={ButtonLinkStyle({ variant: "ghost", size: "lg" })}>
            {t("editDetails")}
          </Link>
        </div>
        <div className="max-w-[360px]">
          <CopyButton
            path={`/${locale}/check?${new URLSearchParams(shareQuery(checked))}`}
            label={t("share")}
            copiedLabel={t("copied")}
            failedLabel={t("copyFailed")}
          />
          <p className="mt-1.5 text-caption text-tertiary">{t("shareNote")}</p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- parts */

type T = Awaited<ReturnType<typeof getTranslations<"check">>>;

const CONDITION_KEY = {
  new: "conditionNew",
  "open-box": "conditionOpenBox",
  used: "conditionUsed",
  unknown: "conditionUnknown",
} as const;

type Tone = "brand" | "caution" | "neutral" | "data" | "risk";

const FIT_STATUS: Record<FitStatus, { key: string; tone: Tone; icon: IconName }> = {
  supported: { key: "fitSupported", tone: "brand", icon: "CircleCheck" },
  uncertain: { key: "fitUncertain", tone: "caution", icon: "CircleAlert" },
  needs_profile: { key: "fitNeedsProfile", tone: "neutral", icon: "Info" },
};

const PRICE_STATUS: Record<PriceStatus, { key: string; tone: Tone; icon: IconName }> = {
  comparable: { key: "priceComparable", tone: "data", icon: "CircleCheck" },
  reference_only: { key: "priceReference", tone: "neutral", icon: "Info" },
  insufficient: { key: "priceInsufficient", tone: "caution", icon: "CircleAlert" },
  stale: { key: "priceStale", tone: "caution", icon: "TriangleAlert" },
};

function toCandidate(racket: Racket): RacketCandidate {
  return {
    id: racket.id,
    brandSlug: racket.brandSlug,
    brandName: racket.brandName,
    slug: racket.slug,
    name: racket.name,
    releaseYear: racket.releaseYear,
    thumbUrl: racket.heroThumbUrl ?? racket.heroImageUrl,
    variants: [...racket.variants]
      .sort((a: RacketVariant, b: RacketVariant) => a.weightGrams - b.weightGrams)
      .map((v) => ({ id: v.id, weightClass: v.weightClass, gripSize: v.gripSize, colourway: v.colourway })),
  };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card padding="md" className="min-w-0">
      <section aria-labelledby={id}>
        <h2 id={id} className="font-display text-h4 font-bold text-primary">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </section>
    </Card>
  );
}

function StatusBadge({ label, tone, icon }: { label: string; tone: Tone; icon: IconName }) {
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

function SampleNotice({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-cork-100 bg-used px-3.5 py-2.5 text-body-sm text-primary">
      <Icon name="Info" size="sm" className="mt-0.5" />
      {text}
    </p>
  );
}

function SentenceList({ t, items, compact }: { t: T; items: Sentence[]; compact?: boolean }) {
  return (
    <ul className={compact ? "mt-1 flex flex-col gap-1" : "mt-3 flex flex-col gap-2"}>
      {items.map((item) => (
        <li key={item.key} className="text-body-sm text-ink-800">
          {t(item.key, item.values)}
        </li>
      ))}
    </ul>
  );
}

function PriceBody({
  t,
  locale,
  price,
  variantLabel,
  conditionLabel,
}: {
  t: T;
  locale: Locale;
  price: PriceContext;
  variantLabel: string;
  conditionLabel: string;
}) {
  const evidenceLine =
    price.observedAt &&
    t("evidenceLine", {
      count: price.sampleSize,
      sellers: price.sellerCount,
      variant: variantLabel,
      condition: conditionLabel,
      date: formatAbsoluteDate(price.observedAt, locale),
    });

  if (price.status === "comparable" && price.range) {
    return (
      <div className="mt-3">
        <p className="price text-[19px] text-primary">
          {t("rangeLine", {
            low: formatDong(price.range.low),
            high: formatDong(price.range.high),
            median: formatDong(price.range.median),
          })}
        </p>
        <p className="mt-1 font-mono text-[11px] text-tertiary">{evidenceLine}</p>
        {price.asking && (
          <p className="mt-3 text-body-sm text-ink-800">
            {t(price.asking === "below" ? "askingBelow" : price.asking === "above" ? "askingAbove" : "askingWithin")}
          </p>
        )}
        {!price.asking && <p className="mt-3 text-body-sm text-secondary">{t("askingNone")}</p>}
      </div>
    );
  }

  const body =
    price.status === "reference_only"
      ? t(price.reason === "variant_unknown" ? "refVariant" : price.reason === "condition_used" ? "refUsed" : "refUnknown")
      : price.status === "stale"
        ? t("staleBody", { hours: FRESH_HOURS })
        : t("insufficientBody", { min: MIN_OBSERVATIONS, sellers: MIN_SELLERS });

  return <p className="mt-3 text-body-sm text-secondary">{body}</p>;
}

function SellerQuestions({ t, questions, copyText }: { t: T; questions: Sentence[]; copyText: string }) {
  return (
    <Card padding="md" tone="brand">
      <section aria-labelledby="check-questions">
        <h2 id="check-questions" className="font-display text-h4 font-bold text-primary">
          {t("questionsTitle")}
        </h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
          {questions.map((q) => (
            <li key={q.key} className="text-body-sm text-ink-800">
              {t(q.key)}
            </li>
          ))}
        </ol>
        <div className="mt-4 sm:max-w-[360px]">
          <CopyButton
            text={copyText}
            variant="primary"
            label={t("copyQuestions")}
            copiedLabel={t("copied")}
            failedLabel={t("copyFailed")}
          />
        </div>
      </section>
    </Card>
  );
}

function InspectionChecklist({ t }: { t: T }) {
  return (
    <Card padding="md" tone="used">
      <section aria-labelledby="check-inspection">
        <h2 id="check-inspection" className="font-display text-h4 font-bold text-primary">
          {t("inspectionTitle")}
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {INSPECTION_CHECKLIST.map((key) => (
            <li key={key} className="flex items-start gap-2 text-body-sm text-ink-800">
              <Icon name="ClipboardCheck" size="sm" className="mt-0.5 text-cork-600" />
              {t(key)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-caption text-tertiary">{t("noCertificate")}</p>
      </section>
    </Card>
  );
}

/** No catalogue model: no fit or price answer, but the questions and the
 *  inspection checklist still help. */
async function UnconfirmedResult({ input }: { input: CheckInput }) {
  const t = await getTranslations("check");
  const questions = questionsForSeller(input.condition, false);
  return (
    <div className="page-shell py-6 lg:py-10">
      <div className="mx-auto flex max-w-[880px] flex-col gap-5">
        <section aria-labelledby="check-model">
          <Eyebrow>{t("modelEyebrow")}</Eyebrow>
          <h1 id="check-model" className="display mt-1.5 text-[24px] text-primary lg:text-h1">
            {input.query}
          </h1>
          <div className="mt-3">
            <Badge tone="caution" icon="CircleAlert">{t("modelUnconfirmed")}</Badge>
          </div>
          <p className="mt-3 max-w-[60ch] text-body-sm text-secondary">{t("modelUnconfirmedBody")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={{ pathname: "/rackets", query: { q: input.query } }}
              className={ButtonLinkStyle({ variant: "secondary", size: "md" })}
            >
              {t("searchCatalogue")}
            </Link>
            <Link
              href={{ pathname: "/check", query: { ...checkQuery(input), edit: "1" } }}
              className={ButtonLinkStyle({ variant: "ghost", size: "md" })}
            >
              {t("editDetails")}
            </Link>
          </div>
        </section>
        <SellerQuestions
          t={t}
          questions={questions}
          copyText={[input.query, ...questions.map((q, i) => `${i + 1}. ${t(q.key)}`)].join("\n")}
        />
        {needsInspection(input.condition) && <InspectionChecklist t={t} />}
      </div>
    </div>
  );
}
