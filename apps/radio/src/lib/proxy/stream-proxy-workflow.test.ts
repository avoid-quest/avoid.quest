import { describe, expect, mock, test } from "bun:test";
import type { AppError } from "@avoid.quest/error";
import { createStreamProxyRequestWorkflow } from "./stream-proxy-workflow";

function createTestPolicy() {
  return {
    errorHeaders(request: Request) {
      return {
        "Access-Control-Allow-Origin": new URL(request.url).origin,
      };
    },
    problem(error: AppError, origin: string, requestId: string) {
      return Response.json(
        {
          code: error.code,
          message: error.safeMessage,
          requestId,
          status: error.status,
        },
        {
          status: error.status,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "x-request-id": requestId,
          },
        }
      );
    },
  };
}

function createRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://radio.test/api/stream-proxy?url=${path}`, init);
}

function createWorkflow(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  options: Partial<
    Pick<
      Parameters<typeof createStreamProxyRequestWorkflow>[0],
      "captureError" | "fetchTimeoutMs" | "maxRangeBytes" | "maxStreamedBytes"
    >
  > = {}
) {
  return createStreamProxyRequestWorkflow({
    ...options,
    fetchImpl,
    proxyPolicy: createTestPolicy(),
  });
}

function handle(
  workflow: ReturnType<typeof createStreamProxyRequestWorkflow>,
  request: Request,
  requestId: string
) {
  return workflow.handle({
    origin: "https://radio.test",
    request,
    requestId,
  });
}

describe("createStreamProxyRequestWorkflow", () => {
  test("rejects missing URLs before fetching upstream", async () => {
    const fetchImpl = mock(async () => new Response("should not fetch"));
    const response = await handle(
      createWorkflow(fetchImpl),
      new Request("https://radio.test/api/stream-proxy"),
      "req_missing_url"
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_URL_REQUIRED",
      requestId: "req_missing_url",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("always relays fallback streams even when upstream advertises CORS", async () => {
    const fetchImpl = mock(
      async () =>
        new Response("audio-bytes", {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "audio/mpeg",
          },
        })
    );
    const response = await handle(
      createWorkflow(fetchImpl),
      createRequest(encodeURIComponent("https://radio.example/live.mp3")),
      "req_proxy_cors"
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    await expect(response.text()).resolves.toBe("audio-bytes");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("forwards bounded Range and ICY request headers", async () => {
    const capture: { forwardedHeaders: Headers | null } = {
      forwardedHeaders: null,
    };
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      capture.forwardedHeaders = new Headers(init?.headers);
      return new Response("audio", { status: 206 });
    });
    const response = await handle(
      createWorkflow(fetchImpl, { maxRangeBytes: 10 }),
      createRequest(encodeURIComponent("https://radio.example/live.mp3"), {
        headers: { "Icy-MetaData": "1", Range: "bytes=100-999" },
      }),
      "req_headers"
    );

    expect(response.status).toBe(206);
    expect(capture.forwardedHeaders?.get("Icy-MetaData")).toBe("1");
    expect(capture.forwardedHeaders?.get("Range")).toBe("bytes=100-109");
  });

  test("rejects invalid Range headers before fetching upstream", async () => {
    const fetchImpl = mock(async () => new Response("should not fetch"));
    const response = await handle(
      createWorkflow(fetchImpl),
      createRequest(encodeURIComponent("https://radio.example/live.mp3"), {
        headers: { Range: "bytes=0-1,3-4" },
      }),
      "req_invalid_range"
    );

    expect(response.status).toBe(416);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_INVALID_RANGE",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("exposes radio response headers without forwarding Content-Length", async () => {
    const fetchImpl = mock(
      async () =>
        new Response("audio-bytes", {
          headers: {
            "Content-Length": "11",
            "Content-Range": "bytes 0-10/100",
            "Content-Type": "audio/aac",
            "Icy-Br": "128",
            "Icy-MetaInt": "16000",
            "Icy-Name": "Example FM",
          },
          status: 206,
        })
    );
    const response = await handle(
      createWorkflow(fetchImpl),
      createRequest(encodeURIComponent("https://radio.example/live.aac")),
      "req_headers"
    );

    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-Range")).toBe("bytes 0-10/100");
    expect(response.headers.get("Icy-MetaInt")).toBe("16000");
    expect(response.headers.get("Icy-Name")).toBe("Example FM");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "Icy-MetaInt"
    );
  });

  test("rejects known oversized responses before streaming", async () => {
    const fetchImpl = mock(
      async () =>
        new Response("oversized", { headers: { "Content-Length": "6" } })
    );
    const response = await handle(
      createWorkflow(fetchImpl, { maxStreamedBytes: 5 }),
      createRequest(encodeURIComponent("https://radio.example/live.mp3")),
      "req_too_large"
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_RESPONSE_TOO_LARGE",
    });
  });

  test("caps unknown-length streams and aborts upstream", async () => {
    let wasCanceled = false;
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      upstreamSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("abc"));
            controller.enqueue(new TextEncoder().encode("def"));
          },
          cancel() {
            wasCanceled = true;
          },
        })
      );
    });
    const response = await handle(
      createWorkflow(fetchImpl, { maxStreamedBytes: 5 }),
      createRequest(encodeURIComponent("https://radio.example/live.mp3")),
      "req_stream_limit"
    );

    await expect(response.text()).resolves.toBe("abcde");
    expect(wasCanceled).toBe(true);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  test("times out upstream requests", async () => {
    const fetchImpl = mock(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        })
    );
    const response = await handle(
      createWorkflow(fetchImpl, { fetchTimeoutMs: 1 }),
      createRequest(encodeURIComponent("https://radio.example/live.mp3")),
      "req_timeout"
    );

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_TIMEOUT",
    });
  });

  test("rejects redirects to private hosts without fetching the target", async () => {
    const fetchedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      fetchedUrls.push(url);
      return Response.redirect("http://metadata.google.internal/latest", 302);
    });
    const response = await handle(
      createWorkflow(fetchImpl),
      createRequest(encodeURIComponent("https://radio.example/live.mp3")),
      "req_private_redirect"
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_INTERNAL_ADDRESS",
    });
    expect(fetchedUrls).toEqual(["https://radio.example/live.mp3"]);
  });

  test("rejects redirect loops at the hop limit", async () => {
    const fetchedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      fetchedUrls.push(url);
      return Response.redirect(
        `https://radio.example/loop-${fetchedUrls.length}`,
        302
      );
    });
    const response = await handle(
      createWorkflow(fetchImpl),
      createRequest(encodeURIComponent("https://radio.example/loop")),
      "req_loop"
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_TOO_MANY_REDIRECTS",
    });
    expect(fetchedUrls).toHaveLength(6);
  });

  test("rejects private, malformed, and unsupported URLs before fetching", async () => {
    const fetchImpl = mock(async () => new Response("should not fetch"));
    const workflow = createWorkflow(fetchImpl);
    const responses = await Promise.all([
      handle(
        workflow,
        createRequest(encodeURIComponent("http://127.0.0.1/live")),
        "req_private"
      ),
      handle(workflow, createRequest("not-a-url"), "req_malformed"),
      handle(
        workflow,
        createRequest(encodeURIComponent("ftp://radio.example/live")),
        "req_protocol"
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 400,
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("maps upstream status and network failures to safe responses", async () => {
    const statusResponse = await handle(
      createWorkflow(
        mock(
          async () =>
            new Response("forbidden", { status: 403, statusText: "Forbidden" })
        )
      ),
      createRequest(encodeURIComponent("https://radio.example/blocked")),
      "req_upstream"
    );
    const captureError = mock(() => undefined);
    const failureResponse = await handle(
      createWorkflow(
        mock(async () => {
          await Promise.resolve();
          throw new Error("private network details");
        }),
        { captureError }
      ),
      createRequest(encodeURIComponent("https://radio.example/failure")),
      "req_failure"
    );

    expect(statusResponse.status).toBe(403);
    await expect(statusResponse.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_UPSTREAM_ERROR",
      message: "Upstream error: 403 Forbidden",
    });
    expect(failureResponse.status).toBe(502);
    await expect(failureResponse.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_FETCH_FAILED",
      message: "Failed to fetch stream",
    });
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
