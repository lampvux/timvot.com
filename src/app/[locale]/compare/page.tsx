// The whole page is a function of `?ids=`, so there is no shell that is not
// already the empty state. Opted out until phase 5 splits the picked-racket
// columns behind a Suspense boundary (docs/performance-plan.md).
export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ButtonLinkStyle,
  EmptyState,
  Eyebrow,
} from "@/components/ds/primitives";
import { BalanceRuler } from "@/components/ds/data";
import { CompareTable, type CompareRow } from "@/components/compare-table";
import { getRacketsBySlugs } from "@/lib/data/repository";
import {
  BALANCE_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  formatDong,
  formatTension,
} from "@/lib/format";
import type { SearchParams } from "@/lib/filters";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });
  return { title: t("title") };
}

const FLEX_ORDER = ["flexible", "medium", "stiff", "extra-stiff"];

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("compare");
  const ts = await getTranslations("specs");
  const te = await getTranslations("enums");
  const tr = await getTranslations("racket");
  const tc = await getTranslations("common");

  const raw = (await searchParams).ids;
  const slugs = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, 4);

  const rackets = await getRacketsBySlugs(slugs);

  if (rackets.length === 0) {
    return (
      <div className="page-shell py-12">
        <h1 className="font-display text-h1 font-bold text-primary">
          {t("title")}
        </h1>
        <div className="mt-6">
          <EmptyState
            title={t("emptyTitle")}
            body={t("emptyBody")}
            action={
              <Link
                href="/rackets"
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {t("browseCatalog")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const rows: CompareRow[] = [
    {
      key: "score",
      label: ts("courtScore"),
      kind: "text",
      higherIsBetter: true,
      values: rackets.map((r) => ({
        display: r.courtScore === null ? "—" : String(r.courtScore),
        numeric: r.courtScore,
      })),
    },
    {
      key: "price",
      label: ts("price"),
      kind: "text",
      higherIsBetter: false,
      values: rackets.map((r) => ({
        display: formatDong(r.lowestPrice ?? r.msrp),
        numeric: r.lowestPrice ?? r.msrp,
      })),
    },
    {
      key: "balance",
      label: ts("balance"),
      kind: "text",
      higherIsBetter: null,
      values: rackets.map((r) => ({
        display: `${r.balancePointMm} mm · ${te(
          BALANCE_MESSAGE_KEY[r.balanceType],
        ).toLowerCase()}`,
        numeric: r.balancePointMm,
      })),
    },
    {
      key: "weight",
      label: ts("weight"),
      kind: "text",
      higherIsBetter: null,
      values: rackets.map((r) => {
        const lightest = [...r.variants].sort(
          (a, b) => a.weightGrams - b.weightGrams,
        )[0];
        return {
          display: lightest
            ? `${lightest.weightClass} · ${lightest.weightGrams} g`
            : "—",
          numeric: lightest?.weightGrams ?? null,
        };
      }),
    },
    {
      key: "flex",
      label: ts("shaftFlex"),
      kind: "text",
      higherIsBetter: null,
      values: rackets.map((r) => ({
        display: te(FLEX_MESSAGE_KEY[r.shaftFlex]),
        numeric: FLEX_ORDER.indexOf(r.shaftFlex),
      })),
    },
    {
      key: "tension",
      label: ts("maxTension"),
      kind: "text",
      higherIsBetter: true,
      values: rackets.map((r) => ({
        display: formatTension(r.maxTensionLbs),
        numeric: r.maxTensionLbs[1],
      })),
    },
    {
      key: "grip",
      label: ts("grip"),
      kind: "text",
      higherIsBetter: null,
      values: rackets.map((r) => ({
        display: [...new Set(r.variants.map((v) => v.gripSize))].join(" · "),
        numeric: null,
      })),
    },
    {
      key: "diameter",
      label: ts("shaftDiameter"),
      kind: "text",
      higherIsBetter: null,
      values: rackets.map((r) => ({
        display: `${r.shaftDiameterMm.toFixed(1)} mm`,
        numeric: r.shaftDiameterMm,
      })),
    },
    {
      key: "released",
      label: ts("released"),
      kind: "text",
      higherIsBetter: true,
      values: rackets.map((r) => ({
        display: String(r.releaseYear),
        numeric: r.releaseYear,
      })),
    },
    ...(["power", "speed", "control", "comfort"] as const).map((axis) => ({
      key: axis,
      label: tr(axis),
      kind: "bar" as const,
      higherIsBetter: true,
      values: rackets.map((r) => ({
        display: r.spec[axis].toFixed(1),
        numeric: r.spec[axis],
      })),
    })),
  ];

  /**
   * "In short" is the thing a human friend would say. It is what turns a
   * table into advice, so it is generated from the same numbers the table
   * shows rather than written by hand.
   */
  const byScore = [...rackets].sort(
    (a, b) => (b.courtScore ?? b.specScore) - (a.courtScore ?? a.specScore),
  );
  const cheapest = [...rackets].sort(
    (a, b) => (a.lowestPrice ?? a.msrp) - (b.lowestPrice ?? b.msrp),
  )[0];
  const fastest = [...rackets].sort((a, b) => b.spec.speed - a.spec.speed)[0];
  const strongest = [...rackets].sort((a, b) => b.spec.power - a.spec.power)[0];
  const highestTension = [...rackets].sort(
    (a, b) => b.maxTensionLbs[1] - a.maxTensionLbs[1],
  )[0];

  const scoreOf = (r: (typeof rackets)[number]) => r.courtScore ?? r.specScore;

  const sentences: string[] = [];
  if (
    byScore.length >= 2 &&
    Math.abs(scoreOf(byScore[0]) - scoreOf(byScore[1])) <= 3
  ) {
    sentences.push(
      t("summaryTwin", {
        a: byScore[0].name,
        b: byScore[1].name,
        style: te("styleAttack").toLowerCase(),
      }),
    );
  }
  if (
    highestTension.maxTensionLbs[1] >
    Math.min(...rackets.map((r) => r.maxTensionLbs[1]))
  ) {
    sentences.push(
      t("summaryTension", {
        name: highestTension.name,
        lbs:
          highestTension.maxTensionLbs[1] -
          Math.min(...rackets.map((r) => r.maxTensionLbs[1])),
      }),
    );
  }
  if (fastest.id !== strongest.id) {
    sentences.push(t("summaryTrade", { name: fastest.name }));
  }
  sentences.push(
    t("summaryCheapest", {
      name: cheapest.name,
      price: formatDong(cheapest.lowestPrice ?? cheapest.msrp),
    }),
  );

  return (
    <div className="page-shell pb-12 pt-6">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-h1 font-bold text-primary">
          {t("title")}
        </h1>
        <Link
          href="/rackets"
          className={ButtonLinkStyle({ variant: "secondary", size: "md" }) + " ml-auto"}
        >
          {t("addRacket")}
        </Link>
      </div>

      <CompareTable
        columns={rackets.map((racket) => ({
          id: racket.id,
          brandName: racket.brandName,
          name: racket.name,
          price: formatDong(racket.lowestPrice ?? racket.msrp),
          meta: tc("sellers", { count: racket.sellerCount }),
          href: `/rackets/${racket.brandSlug}/${racket.slug}`,
        }))}
        rows={rows}
      />

      {/* All markers on one rule — the answer is visible before you read a word. */}
      <section className="mt-6 rounded-md border border-line bg-card p-5">
        <div className="mb-1 flex items-baseline gap-3">
          <Eyebrow as="h2">{ts("balance")}</Eyebrow>
          <span className="font-mono text-[11px] text-[var(--text-disabled)]">
            {rackets.length} markers on one rule
          </span>
        </div>
        <BalanceRuler
          className="mt-4 px-6"
          markers={rackets.map((racket, index) => ({
            mm: racket.balancePointMm,
            label: racket.name.split(" ").slice(-2).join(" "),
            emphasis: index === 0,
          }))}
        />
      </section>

      <section className="mt-6 rounded-md border border-green-200 bg-brand-soft p-6">
        <Eyebrow as="h2" className="!text-brand">
          {t("inShort")}
        </Eyebrow>
        <p className="mt-2.5 max-w-[84ch] text-body-lg text-ink-800">
          {sentences.join(" ")}
        </p>
      </section>
    </div>
  );
}
