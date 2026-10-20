import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: cloudflare({
    imageService: "passthrough",
    prerenderEnvironment: "node",
  }),
  integrations: [react()],
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
    plugins: [tailwindcss() as unknown as never],
  },
});
