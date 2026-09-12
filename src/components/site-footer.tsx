import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * One inverse court-green band per page: the hero and the footer read as the
 * same band, and nothing between them is tinted.
 *
 * A Server Component, and its own file for that reason. It has no state, reads
 * no URL and handles no event — four links and two strings — but it lived in
 * `site-chrome.tsx`, and one `"use client"` at the top of that file is enough
 * to ship every export in it to the browser and hydrate it on every route in
 * the app. `useTranslations` is not a reason to go client: `getTranslations`
 * does the same job on the server.
 */
export async function SiteFooter() {
  const t = await getTranslations("nav");

  return (
    <footer data-theme="inverse" className="bg-green-900 px-4 py-7 lg:px-10">
      <div className="mx-auto flex max-w-[var(--page-max)] flex-wrap items-center gap-x-6 gap-y-3">
        <span className="display text-[15px] text-white">Shuttlecraft</span>
        <div className="flex flex-wrap gap-x-6 text-body-sm">
          {(["methodology", "sellers", "guides"] as const).map((key) => (
            <Link
              key={key}
              href={key === "methodology" ? "/methodology" : `/${key}`}
              className="inline-flex min-h-11 items-center text-secondary no-underline hover:text-white lg:min-h-0"
            >
              {t(key)}
            </Link>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-tertiary">
          Tiếng Việt · English
        </span>
      </div>
    </footer>
  );
}
