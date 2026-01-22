import type { NextConfig } from "next";

const QUALITY_LOW = 60;
const QUALITY_MEDIUM = 75;
const QUALITY_HIGH = 90;

const nextConfig: NextConfig = {
  /* config options here */
  typedRoutes: true,
  reactCompiler: true,
  transpilePackages: ["@avoid.quest/ui"],
  serverExternalPackages: ["@libsql/isomorphic-ws"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.cdninstagram.com",
      },
    ],
    qualities: [QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH],
  },
};

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.NODE_ENV === "development") {
  // Initialize OpenNext Cloudflare for development
  initOpenNextCloudflareForDev();
}

export default nextConfig;
