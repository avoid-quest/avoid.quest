import { waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/image-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const imageUrl = url.searchParams.get("url");

        if (!imageUrl) {
          return new Response("Missing url parameter", { status: 400 });
        }

        // Only allow Pinterest CDN URLs for security
        if (!imageUrl.startsWith("https://i.pinimg.com/")) {
          return new Response("Invalid image URL", { status: 403 });
        }

        // Check Cache API first
        const cache = caches.default;
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }

        try {
          const response = await fetch(imageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "image/*",
            },
          });

          if (!response.ok) {
            return new Response(`Failed to fetch image: ${response.status}`, {
              status: response.status,
            });
          }

          const contentType =
            response.headers.get("Content-Type") || "image/jpeg";
          const imageData = await response.arrayBuffer();

          const proxyResponse = new Response(imageData, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control":
                "public, s-maxage=604800, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
            },
          });

          waitUntil(cache.put(request, proxyResponse.clone()));

          return proxyResponse;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return new Response(`Image proxy error: ${message}`, { status: 500 });
        }
      },
    },
  },
});
