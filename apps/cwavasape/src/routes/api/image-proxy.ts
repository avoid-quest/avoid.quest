import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

// Cache TTL in seconds (7 days for images)
const IMAGE_CACHE_TTL = 604_800;

// Regex for extracting image path from Pinterest URL
const PINIMG_URL_REGEX = /pinimg\.com\/(\d+x)\/(.+)/;

/**
 * Generate a cache key for image URLs
 * Format: img:<url_hash>
 */
function getImageCacheKey(imageUrl: string): string {
  // Extract the path portion for a cleaner key
  // e.g., "https://i.pinimg.com/474x/ab/cd/ef.jpg" -> "img:474x:abcdef"
  const match = imageUrl.match(PINIMG_URL_REGEX);
  if (match) {
    const [, size, path] = match;
    const cleanPath = path.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
    return `img:${size}:${cleanPath}`;
  }
  // Fallback
  return `img:${btoa(imageUrl).slice(0, 48)}`;
}

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

        const cacheKey = getImageCacheKey(imageUrl);

        // Try KV cache first
        try {
          const cached = await env.CACHE?.get(cacheKey, "arrayBuffer");
          if (cached) {
            return new Response(cached, {
              status: 200,
              headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*",
                "X-Cache": "HIT",
              },
            });
          }
        } catch {
          // KV not available - continue without cache
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

          // Only cache images under 20MB (KV limit is 25MB)
          if (imageData.byteLength < 20 * 1024 * 1024) {
            try {
              await env.CACHE?.put(cacheKey, imageData, {
                expirationTtl: IMAGE_CACHE_TTL,
              });
            } catch {
              // Cache write failed - not critical
            }
          }

          return new Response(imageData, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
              "X-Cache": "MISS",
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return new Response(`Image proxy error: ${message}`, { status: 500 });
        }
      },
    },
  },
});
