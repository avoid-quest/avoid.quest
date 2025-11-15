import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  transpilePackages: ["@workspace/ui"],
  serverExternalPackages: ["ioredis", "redis"],
  turbopack: {},
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "bandcamp-fetch",
      "@scdl/fetch-client",
      "scdl-core",
      "dexie",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // outputFileTracingExcludes: {
  //   "*": [
  //     "node_modules/@vercel/og/dist/resvg.wasm",
  //     "node_modules/@vercel/og/dist/yoga.wasm",
  //     "node_modules/@vercel/og/**/*.wasm",
  //   ],
  // },
};

// Initialize OpenNext Cloudflare for development
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

export default nextConfig;
