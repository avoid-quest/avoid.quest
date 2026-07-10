import { describe, expect, mock, test } from "bun:test";
import { getSoundCloudItem } from "./index";

describe("getSoundCloudItem", () => {
  test("prefers HLS over progressive transcodings", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = input.toString();
      requestedUrls.push(url);

      if (url === "https://soundcloud.com/") {
        return Promise.resolve(
          new Response(
            '<script crossorigin src="https://a-v2.sndcdn.com/app.js"></script>'
          )
        );
      }
      if (url === "https://a-v2.sndcdn.com/app.js") {
        return Promise.resolve(new Response('client_id:"test-client-id"'));
      }
      if (url.startsWith("https://api-v2.soundcloud.com/resolve?")) {
        return Promise.resolve(
          Response.json({
            kind: "track",
            media: {
              transcodings: [
                {
                  format: { mime_type: "audio/mpeg", protocol: "progressive" },
                  url: "https://api-v2.soundcloud.com/media/progressive",
                },
                {
                  format: { mime_type: "audio/mpeg", protocol: "hls" },
                  url: "https://api-v2.soundcloud.com/media/hls",
                },
              ],
            },
            title: "Test track",
          })
        );
      }
      if (url.startsWith("https://api-v2.soundcloud.com/media/hls?")) {
        return Promise.resolve(
          Response.json({ url: "https://cf-hls-media.sndcdn.com/live.m3u8" })
        );
      }
      if (url.startsWith("https://api-v2.soundcloud.com/media/progressive?")) {
        return Promise.resolve(
          Response.json({ url: "https://cf-media.sndcdn.com/live.mp3" })
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }) as typeof fetch;

    try {
      await expect(
        getSoundCloudItem("https://soundcloud.com/artist/track")
      ).resolves.toMatchObject({
        format: "hls",
        streamUrl: "https://cf-hls-media.sndcdn.com/live.m3u8",
        success: true,
      });
      expect(requestedUrls).not.toContain(
        "https://api-v2.soundcloud.com/media/progressive?client_id=test-client-id"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
