import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { EventEmitter } from "node:events";

// Increase default max listeners to prevent Node.js stream warnings during concurrent dev/build streams
EventEmitter.defaultMaxListeners = 25;

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  compress: false,
  typedRoutes: false,
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
