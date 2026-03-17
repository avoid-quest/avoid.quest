import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    tailwindcss(),
    tanstackStart(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    minify: "esbuild",
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ["@tanstack/react-devtools", "@tanstack/react-router-devtools"],
  },
});
