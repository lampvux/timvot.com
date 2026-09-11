import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next"
import { routing } from "@/i18n/routing";
import { fontVariables } from "@/app/fonts";
import { AccountSlot } from "@/components/auth-slot";
import { CompareProvider, CompareTray } from "@/components/compare-tray";
import { MobileTabBar, SiteFooter, TopBar } from "@/components/site-chrome";
import { NavigationProgress } from "@/components/navigation-progress";
import {
  finishFunctionProfile,
  profileFunction,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";
import "@/app/globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const started = startFunctionProfile();
  const { locale } = await params;
  const t = await profileFunction("i18n.getTranslations.layoutBrand", () =>
    getTranslations({ locale, namespace: "brand" }),
  );

  const metadata = {
    title: {
      default: `${t("name")} — ${t("tagline")}`,
      template: `%s · ${t("name")}`,
    },
    description: t("tagline"),
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}`]),
      ),
    },
  };
  finishFunctionProfile("layout.generateMetadata", started, { locale });
  return metadata;
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const started = startFunctionProfile();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // Nothing is awaited here on purpose. This layout wraps every route, so a
  // single `cookies()` read in it opts the whole app out of prerendering —
  // see components/auth-slot.tsx, which owns that read behind a Suspense
  // boundary instead.

  finishFunctionProfile("layout.LocaleLayout", started, { locale });

  return (
    <html lang={locale} className={fontVariables}>
      <body className="min-h-dvh">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {/* Reads the URL through client hooks, so it stays behind a boundary
            rather than blocking the static shell of every route. */}
        <Suspense fallback={null}>
          <SpeedInsights />
        </Suspense>
        <Analytics />
        <NextIntlClientProvider>
          <CompareProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[900]
                focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:shadow-2"
            >
              Skip to content
            </a>
            <div className="flex min-h-dvh flex-col">
              <TopBar accountSlot={<AccountSlot />} />
              <main id="main" className="flex-1">
                {children}
              </main>
              <SiteFooter />
              <CompareTray />
              <MobileTabBar />
            </div>
          </CompareProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
