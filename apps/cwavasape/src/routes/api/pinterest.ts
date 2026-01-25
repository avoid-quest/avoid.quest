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

        // Extract username from source_url (e.g., "/maumichi/pins/" -> "maumichi")
        const username = sourceUrl.split("/").filter(Boolean)[0] ?? "";

        const params = new URLSearchParams({
          source_url: sourceUrl,
          data,
        });

        const pinterestUrl = `${PINTEREST_BASE_URL}?${params}`;

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
        return json(responseData);
      },
    },
  },
});
