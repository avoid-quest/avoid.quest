import { waitUntil } from "cloudflare:workers";
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

        // Check Cache API first
        const cache = caches.default;
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }

        const username = sourceUrl.split("/").filter(Boolean)[0] ?? "";

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
          const body = JSON.stringify(responseData);

          const proxyResponse = new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, s-maxage=3600",
            },
          });

          waitUntil(cache.put(request, proxyResponse.clone()));

          return proxyResponse;
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
