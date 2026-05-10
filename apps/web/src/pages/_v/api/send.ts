import type { APIRoute } from "astro";

export const prerender = false;

const UMAMI_COLLECT_URL = "https://umami.net-work.studio/api/send";

export const POST = (async ({ request }) => {
  const response = await fetch(UMAMI_COLLECT_URL, {
    body: await request.arrayBuffer(),
    headers: proxyHeaders(request),
    method: "POST",
  });

  return new Response(response.body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/json",
    },
    status: response.status,
    statusText: response.statusText,
  });
}) satisfies APIRoute;

function proxyHeaders(request: Request) {
  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  const cloudflareConnectingIp = request.headers.get("CF-Connecting-IP");
  const umamiCache = request.headers.get("x-umami-cache");
  const userAgent = request.headers.get("User-Agent");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }

  if (cloudflareConnectingIp) {
    headers.set("CF-Connecting-IP", cloudflareConnectingIp);
  }

  if (umamiCache) {
    headers.set("x-umami-cache", umamiCache);
  }

  return headers;
}
