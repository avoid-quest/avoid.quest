import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg)$/i;

export const Route = createFileRoute("/api/audio-samples")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Check Cache API first
        const cache = caches.default;
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }

        try {
          const listed = await env.cwavasape_audio_samples.list();

          const samples = listed.objects
            .filter((obj) => AUDIO_EXTENSIONS.test(obj.key))
            .map((obj) => ({ key: obj.key, size: obj.size }));

          const body = JSON.stringify({ samples });

          const response = new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, s-maxage=3600, max-age=3600",
            },
          });

          // Only cache non-empty results to avoid caching before bucket is populated
          if (samples.length > 0) {
            waitUntil(cache.put(request, response.clone()));
          }

          return response;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return new Response(
            JSON.stringify({ error: `Failed to list samples: ${message}` }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
