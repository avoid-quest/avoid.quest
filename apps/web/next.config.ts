import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  transpilePackages: ["@workspace/ui"],
};

if (process.env.NODE_ENV === "development") {
  // Initialize OpenNext Cloudflare for development
  initOpenNextCloudflareForDev();
}

export default nextConfig;
