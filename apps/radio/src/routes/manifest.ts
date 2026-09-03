import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/manifest")({
  server: {
    handlers: {
      GET: () => {
        const manifest = {
          background_color: "#000000",
          categories: ["music", "entertainment"],
          description: "Enhanced internet radio player",
          display: "standalone",
          icons: [
            {
              purpose: "any",
              sizes: "192x192",
              src: "/web-app-manifest-192x192.png",
              type: "image/png",
            },
            {
              purpose: "maskable",
              sizes: "192x192",
              src: "/web-app-manifest-192x192.png",
              type: "image/png",
            },
            {
              purpose: "any",
              sizes: "512x512",
              src: "/web-app-manifest-512x512.png",
              type: "image/png",
            },
            {
              purpose: "maskable",
              sizes: "512x512",
              src: "/web-app-manifest-512x512.png",
              type: "image/png",
            },
          ],
          id: "/",
          name: "Radio - avoid.quest",
          scope: "/",
          screenshots: [
            {
              form_factor: "wide",
              label: "Radio app desktop interface",
              sizes: "2870x1614",
              src: "/sh_wide.png",
              type: "image/png",
            },
            {
              form_factor: "narrow",
              label: "Radio app mobile interface",
              sizes: "1240x1620",
              src: "/sh_small.png",
              type: "image/png",
            },
          ],
          short_name: "Radio",
          start_url: "/",
          theme_color: "#000000",
        };
        return json(manifest, {
          headers: {
            "Content-Type": "application/manifest+json",
          },
        });
      },
    },
  },
});
