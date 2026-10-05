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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addVisitorIp(body: ArrayBuffer, clientIp: string | null) {
  try {
    const event: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body)
    );
    if (!(isRecord(event) && isRecord(event.payload))) {
      return null;
    }
    // Umami's built-in payload.ip takes priority over rewritten CDN headers.
    // Replace client-supplied IPs; without Cloudflare's header, use its fallback.
    return new TextEncoder().encode(
      JSON.stringify({
        ...event,
        payload: { ...event.payload, ip: clientIp || undefined },
      })
    );
  } catch {
    return null;
  }
}

async function prepareEventBody(
  request: Request
): Promise<ArrayBuffer | Response> {
  const rawBody = await readEventBody(request);
  if (rawBody !== null) {
    const body = addVisitorIp(rawBody, request.headers.get("CF-Connecting-IP"));
    if (body === null) {
      return new Response("Invalid event", {
        headers: { "Cache-Control": "no-store" },
        status: 400,
      });
    }
    if (body.byteLength <= MAX_UMAMI_EVENT_BYTES) {
      return body.buffer;
    }
  }
  return new Response("Event too large", {
    headers: { "Cache-Control": "no-store" },
    status: 413,
  });
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

  try {
    const body = isScript ? undefined : await prepareEventBody(request);
    if (body instanceof Response) {
      return body;
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
