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
