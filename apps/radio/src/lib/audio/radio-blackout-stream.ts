const RADIO_BLACKOUT_UPSTREAM_URL =
  "https://zeppelin.streampunk.cc/_stream/blackout.mp3";

const RESPONSE_HEADERS = [
  "Accept-Ranges",
  "Content-Length",
  "Content-Range",
  "Content-Type",
  "Icy-Br",
  "Icy-Description",
  "Icy-Genre",
  "Icy-Name",
  "Icy-Url",
] as const;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function handleRadioBlackoutStreamRequest(
  request: Request,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  if (request.method === "HEAD") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg",
      },
    });
  }

  const upstreamHeaders = new Headers({ Accept: "audio/mpeg" });
  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const upstream = await fetchImpl(RADIO_BLACKOUT_UPSTREAM_URL, {
    headers: upstreamHeaders,
    method: "GET",
    signal: request.signal,
  });

  const responseHeaders = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  if (!responseHeaders.has("Content-Type")) {
    responseHeaders.set("Content-Type", "audio/mpeg");
  }

  return new Response(upstream.body, {
    headers: responseHeaders,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
