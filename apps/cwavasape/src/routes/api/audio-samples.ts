import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

const MANIFEST_CACHE_KEY = "audio:manifest:v2";
const MANIFEST_CACHE_TTL = 3600; // 1 hour

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg)$/i;

export const Route = createFileRoute("/api/audio-samples")({
  server: {
    handlers: {
      GET: async () => {
        // Try KV cache first
        try {
          const cached = await env.CACHE?.get(MANIFEST_CACHE_KEY, "text");
          if (cached) {
            return new Response(cached, {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600",
                "X-Cache": "HIT",
              },
            });
          }
        } catch {
          // KV not available - continue without cache
        }

        try {
          const listed = await env.cwavasape_audio_samples.list();

          const samples = listed.objects
            .filter((obj) => AUDIO_EXTENSIONS.test(obj.key))
            .map((obj) => ({ key: obj.key, size: obj.size }));

          const body = JSON.stringify({ samples });

          // Only cache non-empty results to avoid caching before bucket is populated
          if (samples.length > 0) {
            try {
              await env.CACHE?.put(MANIFEST_CACHE_KEY, body, {
                expirationTtl: MANIFEST_CACHE_TTL,
              });
            } catch {
              // Cache write failed - not critical
            }
          }

          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600",
              "X-Cache": "MISS",
            },
          });
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
