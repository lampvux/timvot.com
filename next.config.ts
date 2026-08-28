import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { EventEmitter } from "node:events";

// Increase default max listeners to prevent Node.js stream warnings during concurrent dev/build streams
EventEmitter.defaultMaxListeners = 25;

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  compress: false,
  typedRoutes: false,

  /**
   * Cache Components. This is what lets a route ship a prerendered static
   * shell while the per-visitor parts stream, and on Vercel Hobby that is the
   * whole game: a CDN hit does not invoke the function, and Active CPU (4
   * hours a month) is the budget the free plan actually rations.
   *
   * It also makes PPR the App Router default, so `experimental.ppr` and
   * `experimental_ppr` are gone rather than merely unused.
   */
  cacheComponents: true,

  /**
   * Windows matched to how the data actually moves, which is when the scraper
   * runs — not when somebody loads a page.
   *
   * `revalidate` is the safety net here, not the mechanism: `scrape:sync`
   * calls `revalidateTag` through /api/revalidate the moment it finishes, so a
   * price change appears when it is scraped. That matters on Hobby, where
   * cron jobs are capped at once per day with ±59 minutes of slop and so
   * cannot be the trigger.
   */
  cacheLife: {
    // Specs, names and images. These change when a catalogue scrape lands.
    catalogue: { stale: 3600, revalidate: 21600, expire: 86400 },
    // Prices and deals move faster and are the reason anyone reloads.
    prices: { stale: 300, revalidate: 900, expire: 3600 },
  },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    /**
     * Every distinct (src, width, quality) is one billed transformation, and
     * Vercel Hobby allows 5.000 a month against a catalogue of 3.010 hero
     * images. Past the allowance the optimizer returns 402 and `next/image`
     * renders the alt text, so this is a correctness budget, not a cost one.
     *
     * The defaults offer 16 widths. These are the seven the card and the
     * gallery actually ask for: 96 is the mobile card thumbnail, 256/384 the
     * grid at two and three columns, and the rest cover the gallery at 550px
     * up to a 2x display.
     */
    imageSizes: [96, 256, 384],
    deviceSizes: [640, 828, 1080, 1200],
    /** Racket photography changes when the image scraper runs, not hourly, and
     *  transformations are billed per cache MISS and STALE. */
    minimumCacheTTL: 60 * 60 * 24 * 31,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.in",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
