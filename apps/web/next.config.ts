import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  transpilePackages: ["@workspace/ui"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
