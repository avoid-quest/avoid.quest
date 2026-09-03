const RADIO_BLACKOUT_UPSTREAM_URLS = [
  "http://s.streampunk.cc/blackout.ogg",
  "http://stream.radioblackout.org/blackout.ogg",
] as const;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

async function fetchStream(
  url: string,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<Response> {
  const response = await fetchImpl(url, {
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

function streamResponseHeaders(upstream?: Response): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": upstream?.headers.get("Content-Type") ?? "audio/ogg",
    "X-Content-Type-Options": "nosniff",
  });
}

export async function handleRadioBlackoutStreamRequest(
  request: Request,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  if (request.method === "HEAD") {
    return new Response(null, { headers: streamResponseHeaders() });
  }

  try {
    const upstream = await Promise.any(
      RADIO_BLACKOUT_UPSTREAM_URLS.map((url) =>
        fetchStream(url, request.signal, fetchImpl)
      )
    );
    return new Response(upstream.body, {
      headers: streamResponseHeaders(upstream),
    });
  } catch (error) {
    console.error("[radio-blackout-stream] HTTP relay failed", error);
    return new Response("Radio BlackOut upstream is unavailable", {
      headers: { "Cache-Control": "no-store" },
      status: 502,
    });
  }
}
