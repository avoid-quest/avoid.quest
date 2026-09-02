import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM_URLS = [
  "http://s.streampunk.cc/blackout.ogg",
  "http://stream.radioblackout.org/blackout.ogg",
] as const;

async function fetchStream(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Accept: "audio/ogg,audio/*;q=0.9,*/*;q=0.1",
      "Icy-MetaData": "0",
      "User-Agent": "avoid.quest-radio/1.0",
    },
    redirect: "follow",
    signal,
  });
  if (!(response.ok && response.body)) {
    throw new Error(`Radio BlackOut upstream returned ${response.status}`);
  }
  return response;
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "HEAD") {
    return new Response(null, {
      headers: { "Cache-Control": "no-store", "Content-Type": "audio/ogg" },
    });
  }

  try {
    const upstream = await Promise.any(
      UPSTREAM_URLS.map((url) => fetchStream(url, request.signal))
    );
    return new Response(upstream.body, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("Content-Type") ?? "audio/ogg",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[radio-blackout-stream] HTTP relay failed", error);
    return new Response("Radio BlackOut upstream is unavailable", {
      headers: { "Cache-Control": "no-store" },
      status: 502,
    });
  }
}

export const Route = createFileRoute("/api/radio-blackout-stream")({
  server: {
    handlers: {
      GET: ({ request }) => handleRequest(request),
      HEAD: ({ request }) => handleRequest(request),
    },
  },
});
