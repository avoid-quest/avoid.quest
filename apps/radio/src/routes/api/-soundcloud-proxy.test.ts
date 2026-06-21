import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("cloudflare:workers", () => ({ env: {} }));

let fetchSoundCloudProxyStream: typeof import("./soundcloud-proxy")["fetchSoundCloudProxyStream"];

beforeAll(async () => {
  ({ fetchSoundCloudProxyStream } = await import("./soundcloud-proxy"));
});

function createProxyRequest(range = "bytes=0-10"): Request {
  return new Request("https://radio.test/api/soundcloud-proxy", {
    headers: { range },
  });
}

describe("fetchSoundCloudProxyStream", () => {
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

    const response = await fetchSoundCloudProxyStream(
      initialUrl,
      createProxyRequest(),
      "https://radio.test",
      "req_soundcloud_redirect",
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

    const response = await fetchSoundCloudProxyStream(
      initialUrl,
      createProxyRequest(),
      "https://radio.test",
      "req_soundcloud_protocol_redirect",
      fetchImpl
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "SOUNDCLOUD_PROXY_INVALID_PROTOCOL",
      requestId: "req_soundcloud_protocol_redirect",
    });
    expect(requestedUrls).toEqual([initialUrl]);
  });

  test("follows allowed SoundCloud CDN redirects and preserves streaming headers", async () => {
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

    const response = await fetchSoundCloudProxyStream(
      initialUrl,
      createProxyRequest(),
      "https://radio.test",
      "req_soundcloud_allowed_redirect",
      fetchImpl
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("11");
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
});
