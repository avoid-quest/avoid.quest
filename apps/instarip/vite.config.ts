import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
      }),
      tailwindcss(),
      tsConfigPaths(),
      tanstackStart(),
      react({
        babel: {
          plugins: ["babel-plugin-react-compiler"],
        },
      }),
    ],
    build: {
      minify: "esbuild",
      sourcemap: false,
    },
    optimizeDeps: {
      exclude: ["@tanstack/react-devtools", "@tanstack/react-router-devtools"],
    },
    server: {
      allowedHosts: env.ALLOWED_HOSTS?.split(",").filter(Boolean) || [],
    },
  };
});
