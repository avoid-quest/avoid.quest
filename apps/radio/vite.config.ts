import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { build, defineConfig, type Plugin } from "vite";

const WORKLET_OUT_DIR = ".worklet-build";
const WORKLET_FILENAME = "dsp-processor-bundle.js";
const APP_VERSION = process.env.npm_package_version || "0.5.0";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryReleaseName = process.env.SENTRY_RELEASE ?? `radio@${APP_VERSION}`;
const sentryBuildEnabled = Boolean(
  sentryAuthToken && sentryOrg && sentryProject
);
const missingSentryBuildEnv = [
  ["SENTRY_AUTH_TOKEN", sentryAuthToken],
  ["SENTRY_ORG", sentryOrg],
  ["SENTRY_PROJECT", sentryProject],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (process.env.NODE_ENV === "production" && !sentryBuildEnabled) {
  console.warn(
    `[radio] Sentry sourcemap upload disabled: missing ${missingSentryBuildEnv.join(", ")}`
  );
}

const VENDOR_CHUNK_GROUPS: Array<{
  name: string;
  match: (normalizedId: string) => boolean;
}> = [
  {
    name: "vendor-react",
    match: (id) =>
      id.includes("/node_modules/react/") ||
      id.includes("/node_modules/react-dom/") ||
      id.includes("/node_modules/scheduler/"),
  },
  {
    name: "vendor-tanstack",
    match: (id) => id.includes("/node_modules/@tanstack/"),
  },
  {
    name: "vendor-audio",
    match: (id) =>
      id.includes("/node_modules/@opendaw/") ||
      id.includes("/node_modules/hls.js/"),
  },
  {
    name: "vendor-ui",
    match: (id) =>
      id.includes("/node_modules/@dnd-kit/") ||
      id.includes("/node_modules/lucide-react/"),
  },
];

function manualVendorChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) {
    return undefined;
  }
  const normalizedId = id.replaceAll(path.sep, "/");
  for (const group of VENDOR_CHUNK_GROUPS) {
    if (group.match(normalizedId)) {
      return group.name;
    }
  }
  return "vendor";
}

/**
 * Plugin to build the AudioWorklet processor bundle
 */
function audioWorkletPlugin(): Plugin {
  let workletContent: string | null = null;
  let resolvedRootDir = process.cwd();
  let resolvedOutDir = path.resolve(process.cwd(), "dist");

  return {
    name: "audio-worklet-plugin",

    configResolved(config) {
      resolvedRootDir = config.root;
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },

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
          outDir: path.resolve(resolvedRootDir, WORKLET_OUT_DIR),
          emptyOutDir: true,
          copyPublicDir: false,
          minify: "esbuild",
          sourcemap: false,
        },
        logLevel: "warn",
      });

      // Read the built worklet for serving in dev mode
      const workletPath = path.resolve(
        resolvedRootDir,
        WORKLET_OUT_DIR,
        WORKLET_FILENAME
      );
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
      if (!workletContent) {
        return;
      }

      const targetDirs = new Set<string>([resolvedOutDir]);
      if (path.basename(resolvedOutDir) === "server") {
        targetDirs.add(path.resolve(resolvedOutDir, "..", "client"));
      } else if (path.basename(resolvedOutDir) !== "client") {
        targetDirs.add(path.resolve(resolvedOutDir, "client"));
      }

      if (options.dir) {
        const bundleDir = path.resolve(options.dir);
        targetDirs.add(bundleDir);
        if (path.basename(bundleDir) === "server") {
          targetDirs.add(path.resolve(bundleDir, "..", "client"));
        }
      }

      for (const targetDir of targetDirs) {
        const outPath = path.resolve(targetDir, WORKLET_FILENAME);
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
    tanstackStart(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    ...(sentryBuildEnabled
      ? sentryTanstackStart({
          org: sentryOrg,
          project: sentryProject,
          authToken: sentryAuthToken,
          release: { name: sentryReleaseName },
          telemetry: false,
          autoInstrumentMiddleware: false,
          sourcemaps: {
            filesToDeleteAfterUpload: ["./dist/**/*.map"],
          },
        })
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    minify: "esbuild",
    // "hidden" generates source maps for Sentry upload but omits
    // sourceMappingURL from production bundles (unlike true/inline).
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks: manualVendorChunks,
      },
    },
  },
});
