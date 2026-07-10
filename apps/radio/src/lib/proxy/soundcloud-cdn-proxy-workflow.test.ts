import { describe, expect, mock, test } from "bun:test";
import type { AppError } from "@avoid.quest/error";
import { createSoundCloudCdnProxyWorkflow } from "./soundcloud-cdn-proxy-workflow";

const logSSRFAttempt = mock(() => undefined);

function createProxyRequest(range = "bytes=0-10"): Request {
  return new Request("https://radio.test/api/soundcloud-proxy", {
    headers: { range },
  });
}

function createWorkflow() {
  return createSoundCloudCdnProxyWorkflow({
    logSSRFAttempt,
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

describe("createSoundCloudCdnProxyWorkflow", () => {
  test("maps canonical page-url failures to the SoundCloud response", async () => {
    logSSRFAttempt.mockClear();

    const response = await createWorkflow().handle({
      auth: {
        ip: "203.0.113.10",
        sessionId: "sess_soundcloud",
      },
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/soundcloud-proxy?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack"
      ),
      requestId: "req_soundcloud_page_url",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "SOUNDCLOUD_PROXY_PAGE_URL_NOT_ALLOWED",
      message: "Invalid URL: must be a stream URL, not a page URL",
      requestId: "req_soundcloud_page_url",
      status: 400,
    });
    expect(logSSRFAttempt).not.toHaveBeenCalled();
  });

  test("rejects redirects outside the SoundCloud CDN allowlist before fetching the target", async () => {
    const initialUrl = "https://cf-media.sndcdn.com/track.mp3";
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const forwardedRanges: Array<string | null> = [];
    const forwardedReferers: Array<string | null> = [];
    const forwardedUserAgents: Array<string | null> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);
      forwardedRanges.push(new Headers(init?.headers).get("Range"));
      forwardedReferers.push(new Headers(init?.headers).get("Referer"));
      forwardedUserAgents.push(new Headers(init?.headers).get("User-Agent"));

      if (url === initialUrl) {
        return Response.redirect(
          "http://metadata.google.internal/latest/meta-data",
          302
        );
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    const response = await createWorkflow().fetchStream(
      initialUrl,
      {
        origin: "https://radio.test",
        request: createProxyRequest(),
        requestId: "req_soundcloud_redirect",
      },
      fetchImpl
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "SOUNDCLOUD_PROXY_INVALID_DOMAIN",
      requestId: "req_soundcloud_redirect",
    });
    expect(requestedUrls).toEqual([initialUrl]);
    expect(redirectModes).toEqual(["manual"]);
    expect(forwardedRanges).toEqual(["bytes=0-10"]);
    expect(forwardedReferers).toEqual(["https://soundcloud.com/"]);
    expect(forwardedUserAgents).toEqual([
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ]);
  });

  test("rejects redirects to unsupported protocols before fetching the target", async () => {
    const initialUrl = "https://cf-media.sndcdn.com/track.mp3";
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);

      if (url === initialUrl) {
        return Response.redirect("ftp://cf-media.sndcdn.com/track.mp3", 302);
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    const response = await createWorkflow().fetchStream(
      initialUrl,
      {
        origin: "https://radio.test",
        request: createProxyRequest(),
        requestId: "req_soundcloud_protocol_redirect",
      },
      fetchImpl
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "SOUNDCLOUD_PROXY_INVALID_PROTOCOL",
      requestId: "req_soundcloud_protocol_redirect",
    });
    expect(requestedUrls).toEqual([initialUrl]);
  });

  test("follows allowed SoundCloud CDN redirects and strips limited-body length headers", async () => {
    const initialUrl = "https://cf-media.sndcdn.com/track.mp3";
    const finalUrl = "https://media.soundcloud.com/track.mp3";
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const forwardedRanges: Array<string | null> = [];
    const forwardedReferers: Array<string | null> = [];
    const forwardedUserAgents: Array<string | null> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);
      forwardedRanges.push(new Headers(init?.headers).get("Range"));
      forwardedReferers.push(new Headers(init?.headers).get("Referer"));
      forwardedUserAgents.push(new Headers(init?.headers).get("User-Agent"));

      if (url === initialUrl) {
        return Response.redirect(finalUrl, 302);
      }

      return new Response("sound-bytes", {
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
        requestId: "req_soundcloud_allowed_redirect",
      },
      fetchImpl
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-Range")).toBe("bytes 0-10/11");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    await expect(response.text()).resolves.toBe("sound-bytes");
    expect(requestedUrls).toEqual([initialUrl, finalUrl]);
    expect(redirectModes).toEqual(["manual", "manual"]);
    expect(forwardedRanges).toEqual(["bytes=0-10", "bytes=0-10"]);
    expect(forwardedReferers).toEqual([
      "https://soundcloud.com/",
      "https://soundcloud.com/",
    ]);
    expect(forwardedUserAgents).toEqual([
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ]);
  });

  test("logs invalid-domain URL validation failures as SSRF attempts", async () => {
    logSSRFAttempt.mockClear();

    const response = await createWorkflow().handle({
      auth: {
        ip: "203.0.113.10",
        sessionId: "sess_soundcloud",
      },
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/soundcloud-proxy?url=http%3A%2F%2F127.0.0.1%2Fprivate.mp3"
      ),
      requestId: "req_soundcloud_ssrf",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "SOUNDCLOUD_PROXY_INVALID_DOMAIN",
      requestId: "req_soundcloud_ssrf",
    });
    expect(logSSRFAttempt).toHaveBeenCalledWith(
      "sess_soundcloud",
      "http://127.0.0.1/private.mp3",
      "soundcloud-proxy",
      "203.0.113.10"
    );
  });
});
