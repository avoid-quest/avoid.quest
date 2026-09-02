const RADIO_BLACKOUT_UPSTREAM_URL =
  "https://s.streampunk.cc/blackout.mp3";

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
  const upstreamHeaders = new Headers({ Accept: "audio/mpeg" });
  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const upstream = await fetchImpl(RADIO_BLACKOUT_UPSTREAM_URL, {
    headers: upstreamHeaders,
    method: request.method === "HEAD" ? "HEAD" : "GET",
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

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    headers: responseHeaders,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
