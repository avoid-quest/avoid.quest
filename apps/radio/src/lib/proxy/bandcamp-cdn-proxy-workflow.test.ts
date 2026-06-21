import { describe, expect, mock, test } from "bun:test";
import type { AppError } from "@avoid.quest/error";
import { createBandcampCdnProxyWorkflow } from "./bandcamp-cdn-proxy-workflow";

function createProxyRequest(range = "bytes=0-10"): Request {
  return new Request("https://radio.test/api/bandcamp-proxy", {
    headers: { range },
  });
}

function createWorkflow() {
  return createBandcampCdnProxyWorkflow({
    proxyPolicy: {
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
    },
  });
}

describe("createBandcampCdnProxyWorkflow", () => {
  test("maps canonical invalid-domain failures to the Bandcamp response", async () => {
    const response = await createWorkflow().handle({
      auth: undefined,
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/bandcamp-proxy?url=https%3A%2F%2Fbcbits.com.evil.test%2Ftrack.mp3"
      ),
      requestId: "req_bandcamp_invalid_domain",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BANDCAMP_PROXY_INVALID_DOMAIN",
      message: "Invalid URL: must be a Bandcamp CDN URL",
      requestId: "req_bandcamp_invalid_domain",
      status: 400,
    });
  });

  test("rejects redirects outside the Bandcamp CDN before fetching the target", async () => {
    const initialUrl = "https://t4.bcbits.com/stream.mp3";
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const forwardedRanges: Array<string | null> = [];
    const forwardedReferers: Array<string | null> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);
      forwardedRanges.push(new Headers(init?.headers).get("Range"));
      forwardedReferers.push(new Headers(init?.headers).get("Referer"));

      if (url === initialUrl) {
        return Response.redirect("http://127.0.0.1/private.mp3", 302);
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    const response = await createWorkflow().fetchStream(
      initialUrl,
      {
        origin: "https://radio.test",
        request: createProxyRequest(),
        requestId: "req_bandcamp_redirect",
      },
      fetchImpl
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "BANDCAMP_PROXY_INVALID_DOMAIN",
      requestId: "req_bandcamp_redirect",
    });
    expect(requestedUrls).toEqual([initialUrl]);
    expect(redirectModes).toEqual(["manual"]);
    expect(forwardedRanges).toEqual(["bytes=0-10"]);
    expect(forwardedReferers).toEqual(["https://bandcamp.com/"]);
  });

  test("follows allowed Bandcamp CDN redirects and preserves streaming headers", async () => {
    const initialUrl = "https://t4.bcbits.com/stream.mp3";
    const finalUrl = "https://t4.bcbits.com/final.mp3";
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const forwardedRanges: Array<string | null> = [];
    const forwardedReferers: Array<string | null> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);
      forwardedRanges.push(new Headers(init?.headers).get("Range"));
      forwardedReferers.push(new Headers(init?.headers).get("Referer"));

      if (url === initialUrl) {
        return Response.redirect(finalUrl, 302);
      }

      return new Response("audio-bytes", {
        status: 206,
        headers: {
          "Content-Length": "11",
          "Content-Range": "bytes 0-10/11",
          "Content-Type": "audio/mpeg",
        },
      });
    });

    const response = await createWorkflow().fetchStream(
      initialUrl,
      {
        origin: "https://radio.test",
        request: createProxyRequest(),
        requestId: "req_bandcamp_allowed_redirect",
      },
      fetchImpl
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-10/11");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    await expect(response.text()).resolves.toBe("audio-bytes");
    expect(requestedUrls).toEqual([initialUrl, finalUrl]);
    expect(redirectModes).toEqual(["manual", "manual"]);
    expect(forwardedRanges).toEqual(["bytes=0-10", "bytes=0-10"]);
    expect(forwardedReferers).toEqual([
      "https://bandcamp.com/",
      "https://bandcamp.com/",
    ]);
  });
});
