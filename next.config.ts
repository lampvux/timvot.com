import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { EventEmitter } from "node:events";

// Increase default max listeners to prevent Node.js stream warnings during concurrent dev/build streams
EventEmitter.defaultMaxListeners = 25;

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /**
   * Off because Vercel's edge compresses every response itself, so doing it in
   * the Node process too would be work done twice. This is a hosting
   * assumption, not a preference: served from `next start` anywhere else, this
   * ships uncompressed HTML — turn it back on if this ever runs off Vercel.
   */
  compress: false,
  typedRoutes: false,

  /**
   * `X-Powered-By: Next.js` off. Not a vulnerability on its own — it is a free
   * hint about what to try, and free hints are what turn a broad scan into a
   * targeted attempt.
   */
  poweredByHeader: false,

  /**
   * Keep every production source-map layer off. Browser and server maps are
   * already opt-in, but prerender and Turbopack maps default to on and add
   * avoidable memory pressure during this catalogue-heavy build.
   */
  productionBrowserSourceMaps: false,
  enablePrerenderSourceMaps: false,

  /**
   * `next build` uses Turbopack by default. This empty block also makes the
   * Webpack fallback below explicitly intentional to Next.js 16.
   */
  turbopack: {},

  /** Disable the production cache if a build explicitly opts into Webpack. */
  webpack(config, { dev }) {
    if (!dev) config.cache = false;
    return config;
  },

  /**
   * A cached catalogue fill can briefly exceed Next's 60 second default when
   * four static workers share a two-core GitHub runner. The data is bounded
   * and cached, so restarting the same page three times only adds load. Give a
   * healthy fill time to finish while the workflow's page budget keeps the
   * total build within the runner's memory ceiling.
   */
  staticPageGenerationTimeout: 180,

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
    /**
     * How long the client router may reuse a page segment it already has.
     *
     * The `dynamic` default is 0, so going back to `/rackets` from a detail
     * page refetched the whole filtered result even when the visitor had been
     * looking at it two seconds earlier — the commonest movement on the site,
     * and the one that felt slowest. Thirty seconds of reuse makes the back
     * step instant.
     *
     * The freshness cost is bounded by what the data does: prices move when
     * the scraper runs overnight, not while somebody is browsing, and
     * `scrape:sync` invalidates the server's cache tags regardless. Reversible
     * in one line if a page ever does need per-navigation freshness.
     */
    staleTimes: { dynamic: 30 },
    cpus: process.env.NEXT_BUILD_CPUS ? Number(process.env.NEXT_BUILD_CPUS) : undefined,
    /**
     * Static child processes discard `--max-old-space-size`. Worker threads
     * inherit the 6 GB limit from the build script, so the setting reaches the
     * phase that previously aborted near the default 2 GB ceiling.
     */
    workerThreads: true,
    /** Bound each worker's transient render fan-out (the default is eight). */
    staticGenerationMaxConcurrency: 2,
    /**
     * CI builds from a clean checkout and does not restore `.next/cache`, so
     * writing Turbopack's build cache only spends memory and I/O.
     */
    turbopackFileSystemCacheForBuild: false,
    turbopackSourceMaps: false,
    turbopackInputSourceMaps: false,
    serverSourceMaps: false,
    preloadEntriesOnStart: false,
    /** Keep the lower-memory Webpack path healthy for explicit --webpack runs. */
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  /**
   * Security headers.
   *
   * None of these were set before, which meant the app relied entirely on
   * browser defaults: no framing policy, no MIME-sniffing protection, a
   * referrer sent in full to every outbound link, and no transport pinning.
   *
   * The CSP is the one with teeth and the one that needs care. It has to allow
   * what the app actually does:
   *
   *   - Supabase storage, for every product photograph. The origin is read
   *     from the same env var `images.remotePatterns` matches, so the two
   *     cannot disagree; `https:` stays in `img-src` as the fallback for a
   *     deployment whose storage origin is not set at build time.
   *   - Vercel Analytics and Speed Insights, which load a script from the
   *     deployment's own origin and beacon back to it.
   *   - `'unsafe-inline'` for styles, because Next injects the critical CSS
   *     inline, and for scripts because the App Router's streaming payload
   *     arrives as inline `<script>` tags. Nonces would be the stronger
   *     answer and would make every route dynamic, which is the opposite of
   *     what this app is built around.
   *
   * `e2e/security-headers.spec.ts` asserts each of these on a prerendered
   * route and a dynamic one, so a header that gets dropped fails a test rather
   * than being noticed by a scanner months later.
   */
  async headers() {
    const supabaseOrigin = (() => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url) return null;
      try {
        return new URL(url).origin;
      } catch {
        return null;
      }
    })();

    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      // No plugins, and no <base> or <object> redirection of relative URLs.
      "object-src 'none'",
      // Nothing may frame this app: the catalogue carries prices, and a
      // transparent overlay over a "set price alert" button is a real click.
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      `img-src 'self' data: blob: https:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
      `connect-src 'self' https://vitals.vercel-insights.com${
        supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace(/^https:/, "wss:")}` : ""
      }`,
      "frame-src 'none'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // Nothing here needs a camera, a microphone or a location.
            key: "Permissions-Policy",
            value:
              "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
              "magnetometer=(), microphone=(), payment=(), usb=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
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
