import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { build, defineConfig, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const WORKLET_OUT_DIR = ".worklet-build";
const WORKLET_FILENAME = "dsp-processor-bundle.js";

/**
 * Plugin to build the AudioWorklet processor bundle
 */
function audioWorkletPlugin(): Plugin {
  let workletContent: string | null = null;

  return {
    name: "audio-worklet-plugin",

    async buildStart() {
      // Build worklet to a temporary directory
      await build({
        configFile: false,
        publicDir: false,
        build: {
          lib: {
            entry: "src/lib/audio/dsp/worklet-entry.ts",
            formats: ["iife"],
            name: "DSPWorklet",
            fileName: () => WORKLET_FILENAME,
          },
          outDir: WORKLET_OUT_DIR,
          emptyOutDir: true,
          copyPublicDir: false,
          minify: "esbuild",
          sourcemap: false,
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        },
        logLevel: "warn",
      });

      // Read the built worklet for serving in dev mode
      const workletPath = path.resolve(WORKLET_OUT_DIR, WORKLET_FILENAME);
      if (existsSync(workletPath)) {
        workletContent = readFileSync(workletPath, "utf-8");
      }
    },

    // Serve the worklet during development
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === `/${WORKLET_FILENAME}` && workletContent) {
          res.setHeader("Content-Type", "application/javascript");
          res.end(workletContent);
          return;
        }
        next();
      });
    },

    // Copy worklet to dist during production build
    writeBundle(options) {
      if (options.dir?.includes("client") && workletContent) {
        const outPath = path.resolve(options.dir, WORKLET_FILENAME);
        mkdirSync(path.dirname(outPath), { recursive: true });
        writeFileSync(outPath, workletContent);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    audioWorkletPlugin(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    // Let Cloudflare plugin handle chunking for Workers
    // The router bundle will be large (~1MB) for SSR as TanStack Start
    // needs all routes bundled for server-side rendering on Workers
    minify: "esbuild",
    sourcemap: false,
  },
  // Optimize dependencies - exclude devtools from production builds
  optimizeDeps: {
    exclude: ["@tanstack/react-devtools", "@tanstack/react-router-devtools"],
  },
});
