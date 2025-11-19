import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

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
});
