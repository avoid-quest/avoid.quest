import type { APIRoute } from "astro";

export const prerender = false;

const UMAMI_ORIGIN = "https://umami.net-work.studio";

export const ALL: APIRoute = async ({ params, request }) => {
  const { path } = params;

  if (!path) {
    return new Response("Not found", { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(`/${path}`, UMAMI_ORIGIN);
  upstreamUrl.search = requestUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  const userAgent = request.headers.get("User-Agent");
  const clientIp = request.headers.get("CF-Connecting-IP");
  const cache = request.headers.get("x-umami-cache");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }
  if (clientIp) {
    headers.set("CF-Connecting-IP", clientIp);
  }
  if (cache) {
    headers.set("x-umami-cache", cache);
  }

  const upstream = await fetch(upstreamUrl, {
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    headers,
    method: request.method,
  });

  const isScript = path.endsWith(".js");

  return new Response(upstream.body, {
    headers: {
      "Cache-Control": isScript
        ? "public, max-age=3600, s-maxage=86400"
        : "no-store",
      "Content-Type":
        upstream.headers.get("Content-Type") ??
        (isScript
          ? "application/javascript; charset=utf-8"
          : "application/json"),
    },
    status: upstream.status,
  });
};
