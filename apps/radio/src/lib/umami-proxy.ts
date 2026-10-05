const UMAMI_ORIGIN = "https://umami.net-work.studio";
export const MAX_UMAMI_EVENT_BYTES = 64 * 1024;

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

async function readEventBody(request: Request): Promise<ArrayBuffer | null> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (declaredLength > MAX_UMAMI_EVENT_BYTES) {
    await request.body?.cancel();
    return null;
  }
  if (!request.body) {
    return new ArrayBuffer(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const { value } = chunk;
      length += value.byteLength;
      if (length > MAX_UMAMI_EVENT_BYTES) {
        // biome-ignore lint/performance/noAwaitInLoops: stop this sequential stream before returning.
        await reader.cancel();
        return null;
      }
      chunks.push(value);
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

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

  // Cross-zone fetch rewrites standard IP headers. Umami must be configured
  // with CLIENT_IP_HEADER=x-radio-client-ip; never copy browser-forwarded IPs.
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) {
    headers.set("x-radio-client-ip", clientIp);
  }

  try {
    const body = isScript ? undefined : await readEventBody(request);
    if (body === null) {
      return new Response("Event too large", {
        headers: { "Cache-Control": "no-store" },
        status: 413,
      });
    }
    const upstream = await fetchImpl(
      `${UMAMI_ORIGIN}${isScript ? "/script.js" : "/api/send"}`,
      {
        body,
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

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      headers: responseHeaders,
      status: upstream.status,
    });
  } catch {
    return new Response("Upstream unavailable", {
      headers: { "Cache-Control": "no-store" },
      status: 502,
    });
  }
}
