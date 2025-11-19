import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

// Regex to extract package name from node_modules path
const PACKAGE_NAME_REGEX = /node_modules\/(@[^/]+\/[^/]+|[^/]+)/;

// Plugin to handle Node.js 'url' module import in bandcamp-fetch
// Cloudflare Workers with nodejs_compat have URL as a global, not from 'url' module
function resolveNodeUrlModule(): Plugin {
  return {
    name: "resolve-node-url-module",
    resolveId(id) {
      // Resolve Node.js 'url' module imports to a polyfill that uses global URL
      if (id === "url") {
        return {
          id: "\0url-polyfill",
          moduleSideEffects: false,
        };
      }
      return null;
    },
    load(id) {
      // Provide a polyfill for 'url' module that exports URL from global scope
      // In Cloudflare Workers with nodejs_compat, URL is available as a global
      if (id === "\0url-polyfill") {
        // Export the global URL constructor (available with nodejs_compat)
        return "export const URL = globalThis.URL;";
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    resolveNodeUrlModule(),
  ],
  build: {
    // Increase chunk size warning limit for SSR builds (Cloudflare Workers can handle larger chunks)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // Suppress eval warnings from bottleneck (harmless in Cloudflare Workers)
      onwarn(warning, warn) {
        // Suppress eval warnings from bottleneck's Redis connection code
        if (
          warning.code === "EVAL" &&
          warning.id &&
          warning.id.includes("bottleneck")
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        // Manual chunking strategy for better code splitting
        manualChunks: (id) => {
          if (!id.includes("node_modules")) {
            return;
          }

          // Keep TypeScript helpers (tslib) with vendor-misc to avoid splitting issues
          if (id.includes("tslib")) {
            return "vendor-misc";
          }

          // Define chunk mappings - order matters (more specific first)
          const chunkMap: [string[], string][] = [
            [["react", "react-dom"], "vendor-react"],
            [["@tanstack"], "vendor-tanstack"],
            [["@dnd-kit", "lucide-react", "sonner"], "vendor-ui"],
            [["@avoid.quest/cacophony"], "vendor-audio"],
            [
              [
                "bandcamp-fetch",
                "@scdl",
                "@workspace/scdl-core",
                "bottleneck",
                "cheerio",
                "html-entities",
                "node-cache",
              ],
              "vendor-platforms",
            ],
            [["dexie"], "vendor-db"],
            [["react-hook-form", "@hookform"], "vendor-forms"],
            // Split large utility libraries
            [["zod"], "vendor-zod"],
            [["lz-string"], "vendor-compression"],
            [["next-themes"], "vendor-theme"],
            // Split Cloudflare and Vite plugins (SSR only)
            [["@cloudflare", "wrangler"], "vendor-cloudflare"],
          ];

          // Find matching chunk
          for (const [patterns, chunkName] of chunkMap) {
            if (patterns.some((pattern) => id.includes(pattern))) {
              return chunkName;
            }
          }

          // Split remaining vendor by first package name to avoid huge chunks
          // But skip .bun paths to avoid splitting TypeScript helpers incorrectly
          if (id.includes(".bun")) {
            return "vendor-misc";
          }

          const match = id.match(PACKAGE_NAME_REGEX);
          if (match) {
            const pkgName = match[1];
            // Group small packages together, keep large ones separate
            if (pkgName.startsWith("@")) {
              return `vendor-${pkgName.replace("@", "").replace("/", "-")}`;
            }
            return `vendor-${pkgName}`;
          }

          // Fallback
          return "vendor-misc";
        },
      },
    },
  },
  esbuild: {
    legalComments: "none",
    // Ensure TypeScript helpers are inlined (esbuild handles this natively)
    target: "es2022",
  },
  optimizeDeps: {
    // Ensure tslib is included if needed
    include: ["tslib"],
  },
});
