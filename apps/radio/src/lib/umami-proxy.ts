const UMAMI_ORIGIN = "https://umami.net-work.studio";

const REQUEST_HEADERS = [
  "content-type",
  "user-agent",
  "x-umami-cache",
  "x-umami-website-id",
  "x-umami-hostname",
  "cf-ipcountry",
  "cf-region-code",
  "cf-ipcity",
] as const;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function handleUmamiRequest(
  request: Request,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const isScript = pathname === "/u/script.js";
  if (!isScript && pathname !== "/u/api/send") {
    return new Response("Not found", { status: 404 });
  }

  const allowedMethods = isScript ? ["GET", "HEAD"] : ["POST"];
  if (!allowedMethods.includes(request.method)) {
    return new Response("Method not allowed", {
      headers: { Allow: allowedMethods.join(", ") },
      status: 405,
    });
  }

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  // Cloudflare rewrites CF-Connecting-IP on cross-zone Worker subrequests.
  // Umami checks True-Client-IP first; never trust the browser's forwarded IPs.
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) {
    headers.set("True-Client-IP", clientIp);
  }

  try {
    const upstream = await fetchImpl(
      `${UMAMI_ORIGIN}${isScript ? "/script.js" : "/api/send"}`,
      {
        body: isScript ? undefined : await request.arrayBuffer(),
        headers,
        method: request.method,
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      }
    );
    // Workers support manual/follow only. Never follow or expose redirects.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      throw new Error("Unexpected upstream redirect");
    }
    const responseHeaders = new Headers({
      "Cache-Control":
        isScript && upstream.ok ? "public, max-age=3600" : "no-store",
      "Content-Type":
        upstream.headers.get("Content-Type") ??
        (isScript
          ? "application/javascript; charset=utf-8"
          : "application/json"),
      "X-Content-Type-Options": "nosniff",
    });
    const retryAfter = upstream.headers.get("Retry-After");
    if (retryAfter) {
      responseHeaders.set("Retry-After", retryAfter);
    }

    return new Response(
      request.method === "HEAD" || upstream.body === null
        ? null
        : await upstream.text(),
      { headers: responseHeaders, status: upstream.status }
    );
  } catch {
    return new Response("Upstream unavailable", {
      headers: { "Cache-Control": "no-store" },
      status: 502,
    });
  }
}
