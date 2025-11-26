import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/manifest")({
  server: {
    handlers: {
      GET: () => {
        const manifest = {
          id: "/",
          name: "Radio - avoid.quest",
          short_name: "Radio",
          description: "Enhanced internet radio player",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#000000",
          theme_color: "#000000",
          categories: ["music", "entertainment"],
          screenshots: [
            {
              src: "/sh_wide.png",
              sizes: "2870x1614",
              type: "image/png",
              form_factor: "wide",
              label: "Radio app desktop interface",
            },
            {
              src: "/sh_small.png",
              sizes: "1240x1620",
              type: "image/png",
              form_factor: "narrow",
              label: "Radio app mobile interface",
            },
          ],
          icons: [
            {
              src: "/web-app-manifest-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/web-app-manifest-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/web-app-manifest-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/web-app-manifest-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
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
