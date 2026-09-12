import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next"
import { routing } from "@/i18n/routing";
import { clientMessages } from "@/i18n/client-namespaces";
import { SUPABASE_ORIGIN } from "@/lib/supabase/config";
import { fontVariables } from "@/app/fonts";
import { AccountSlot } from "@/components/auth-slot";
import { CompareProvider, CompareTray } from "@/components/compare-tray";
import { MobileTabBar, TopBar } from "@/components/site-chrome";
import { SiteFooter } from "@/components/site-footer";
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

  // Nothing that reads the *request* is awaited here on purpose. This layout
  // wraps every route, so a single `cookies()` read in it opts the whole app
  // out of prerendering — see components/auth-slot.tsx, which owns that read
  // behind a Suspense boundary instead. Messages are keyed on the locale
  // segment, not on the request, so they are safe to await.
  const messages = await getMessages({ locale });

  finishFunctionProfile("layout.LocaleLayout", started, { locale });

  return (
    <html lang={locale} className={fontVariables}>
      <head>
        {/* Every product image on the site comes from this origin, and the
            browser would not otherwise start talking to it until it parsed the
            first card. DNS + TCP + TLS to Singapore is 200–300 ms on mobile,
            and it lands in front of the LCP image rather than beside it. */}
        {SUPABASE_ORIGIN && (
          <>
            <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
            {/* For browsers that are at their preconnect limit and drop the
                hint above: resolving the name is still most of the saving. */}
            <link rel="dns-prefetch" href={SUPABASE_ORIGIN} />
          </>
        )}
      </head>
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
        {/* Only the namespaces a Client Component can actually read. Without
            the prop, next-intl serialises the whole message file — 26,8 KB of
            `vi` — into every route's payload, most of it for surfaces that
            render entirely on the server. `i18n/client-namespaces.test.ts`
            fails if the list and the source disagree. */}
        <NextIntlClientProvider messages={clientMessages(messages)}>
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
