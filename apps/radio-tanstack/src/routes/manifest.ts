import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/manifest')({
  server: {
    handlers: {
      GET: () => {
        const manifest = {
          name: "radio.avoid.quest",
          short_name: "radio",
          description: "Enhanced internet radio player",
          start_url: "/",
          display: "standalone",
          background_color: "#000000",
          theme_color: "#000000",
          orientation: "portrait-primary",
          icons: [
            {
              src: "/web-app-manifest-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/web-app-manifest-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
          ],
        };
        return json(manifest, {
          headers: {
            'Content-Type': 'application/manifest+json',
          },
        });
      },
    },
  },
})

