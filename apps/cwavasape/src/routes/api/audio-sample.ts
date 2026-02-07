import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { CONTENT_TYPES, SAFE_KEY_PATTERN } from "../../lib/audio-constants";

export const Route = createFileRoute("/api/audio-sample")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");

        if (!key) {
          return new Response("Missing key parameter", { status: 400 });
        }

        if (
          key.includes("..") ||
          key.startsWith("/") ||
          !SAFE_KEY_PATTERN.test(key)
        ) {
          return new Response("Invalid key", { status: 400 });
        }

        const ext = key.split(".").pop()?.toLowerCase();
        if (!(ext && CONTENT_TYPES[ext])) {
          return new Response("Invalid audio file type", { status: 400 });
        }

        try {
          const object = await env.cwavasape_audio_samples.get(key);

          if (!object) {
            return new Response("Sample not found", { status: 404 });
          }

          return new Response(object.body, {
            status: 200,
            headers: {
              "Content-Type":
                object.httpMetadata?.contentType ?? CONTENT_TYPES[ext],
              "Cache-Control": "public, max-age=2592000, immutable",
              "Content-Length": String(object.size),
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return new Response(`Audio sample error: ${message}`, {
            status: 500,
          });
        }
      },
    },
  },
});
