import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

// Plugin to externalize bandcamp-fetch for SSR builds
// This prevents it from being bundled and allows dynamic import at runtime
function externalizeBandcampFetch(): Plugin {
  return {
    name: "externalize-bandcamp-fetch",
    apply: "build",
    enforce: "pre",
    resolveId(id) {
      if (id === "bandcamp-fetch") {
        return { id, external: true };
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
    externalizeBandcampFetch(),
  ],
});
