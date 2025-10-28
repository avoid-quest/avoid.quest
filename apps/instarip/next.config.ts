import type { NextConfig } from "next";

const QUALITY_LOW = 60;
const QUALITY_MEDIUM = 75;
const QUALITY_HIGH = 90;

const nextConfig: NextConfig = {
  /* config options here */
  typedRoutes: true,
  reactCompiler: true,
  transpilePackages: ["@workspace/ui"],
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

export default nextConfig;

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();
