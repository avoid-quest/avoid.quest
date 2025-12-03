import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
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
