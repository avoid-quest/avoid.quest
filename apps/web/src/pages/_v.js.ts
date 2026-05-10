import type { APIRoute } from "astro";

export const prerender = false;

const UMAMI_SCRIPT_URL = "https://umami.net-work.studio/script.js";

export const GET = (async () => {
  const response = await fetch(UMAMI_SCRIPT_URL);

  return new Response(response.body, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type":
        response.headers.get("Content-Type") ??
        "application/javascript; charset=utf-8",
    },
    status: response.status,
    statusText: response.statusText,
  });
}) satisfies APIRoute;
