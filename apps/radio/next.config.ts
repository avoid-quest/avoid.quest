import { resolve } from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const isCloudflareBuild =
  process.env.CLOUDFLARE_BUILD === "true" || process.env.CF_BUILD === "true";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  transpilePackages: ["@workspace/ui"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  webpack: (config) => {
    // During Cloudflare builds, alias @avoid.quest/cacophony to use the published package
    // instead of the workspace symlink
    if (isCloudflareBuild) {
      if (!config.resolve) {
        config.resolve = {};
      }
      if (!config.resolve.alias) {
        config.resolve.alias = {};
      }

      // Resolve to the published package in node_modules
      // This ensures webpack uses the published version instead of the workspace link
      const cacophonyPath = resolve(
        process.cwd(),
        "node_modules/@avoid.quest/cacophony"
      );
      config.resolve.alias["@avoid.quest/cacophony"] = cacophonyPath;
    }

    return config;
  },
};

// Initialize OpenNext Cloudflare for development
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

export default nextConfig;
