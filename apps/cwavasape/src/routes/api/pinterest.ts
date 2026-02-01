import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

const PINTEREST_BASE_URL =
  "https://www.pinterest.com/resource/UserPinsResource/get/";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json",
};

// Cache TTL in seconds (1 hour)
const CACHE_TTL = 3600;

/**
 * Generate a cache key for Pinterest API requests
 * Format: pinterest:<username>:<bookmark_hash>
 */
function getCacheKey(username: string, data: string): string {
  // Parse the data JSON to extract bookmark for key
  try {
    const parsed = JSON.parse(data);
    const bookmark = parsed.options?.bookmarks?.[0] || "first";
    // Create a short hash of the bookmark to keep key manageable
    const bookmarkKey =
      bookmark === "first"
        ? "first"
        : bookmark.slice(0, 32).replace(/[^a-zA-Z0-9]/g, "");
    return `pinterest:${username}:${bookmarkKey}`;
  } catch {
    // Fallback to hashing the entire data string
    return `pinterest:${username}:${btoa(data).slice(0, 32)}`;
  }
}

export const Route = createFileRoute("/api/pinterest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sourceUrl = url.searchParams.get("source_url");
        const data = url.searchParams.get("data");

        if (!(sourceUrl && data)) {
          return json(
            { error: "Missing required parameters" },
            { status: 400 }
          );
        }

        // Extract username from source_url (e.g., "/gemakara/pins/" -> "gemakara")
        const username = sourceUrl.split("/").filter(Boolean)[0] ?? "";
        const cacheKey = getCacheKey(username, data);

        // Try to get from KV cache first
        try {
          const cached = await env.CACHE?.get(cacheKey, "json");
          if (cached) {
            // Return cached response with cache hit header
            return json(cached, {
              headers: { "X-Cache": "HIT" },
            });
          }
        } catch {
          // KV not available (dev mode without bindings) - continue without cache
        }

        const params = new URLSearchParams({
          source_url: sourceUrl,
          data,
        });

        const pinterestUrl = `${PINTEREST_BASE_URL}?${params}`;

        try {
          const response = await fetch(pinterestUrl, {
            headers: {
              ...HEADERS,
              "X-Pinterest-PWS-Handler": `www/${username}.js`,
            },
          });

          if (!response.ok) {
            return json(
              { error: `Pinterest API error: ${response.status}` },
              { status: response.status }
            );
          }

          const responseData = await response.json();

          // Store in KV cache (fire and forget)
          try {
            await env.CACHE?.put(cacheKey, JSON.stringify(responseData), {
              expirationTtl: CACHE_TTL,
            });
          } catch {
            // Cache write failed - not critical, continue
          }

          return json(responseData, {
            headers: { "X-Cache": "MISS" },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Network error";
          return json(
            { error: `Pinterest request failed: ${message}` },
            { status: 502 }
          );
        }
      },
    },
  },
});
