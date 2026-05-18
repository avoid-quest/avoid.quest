import { describe, expect, test } from "bun:test";
import {
  tryAirtimeLiveInfo,
  tryNtsLiveApi,
  tryRadioBlackoutApi,
} from "./external-providers";

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("external radio metadata providers", () => {
  test("normalizes Sygma/Airtime live-info style current tracks", async () => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo({
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            tracks: {
              current: {
                name: " - ignored fallback",
                metadata: {
                  artist_name: "",
                  track_title: "GUESTS 179 – naîve",
                },
              },
            },
          })
        );
      },
      streamUrl: "https://radio.syg.ma/audio.ogg",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(calls[0]).toBe("https://radio.syg.ma/stats-icecast.json");
    expect(result?.source).toBe("airtime-live-info");
    expect(result?.title).toBe("GUESTS 179 – naîve");
  });

  test("continues Airtime fallbacks after a candidate fetch throws", async () => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo(
      {
        fetchImpl: (url) => {
          calls.push(url);
          if (url === "https://bad.example/live-info") {
            throw new TypeError("fetch failed");
          }
          return Promise.resolve(
            json({
              tracks: {
                current: {
                  name: "Recovered Show",
                },
              },
            })
          );
        },
        streamUrl: "https://radio.example/audio.mp3",
        sampledAt: 1000,
        expiresAt: 2000,
      },
      ["https://bad.example/live-info", "https://good.example/live-info"]
    );

    expect(calls).toEqual([
      "https://bad.example/live-info",
      "https://good.example/live-info",
    ]);
    expect(result?.source).toBe("airtime-live-info");
    expect(result?.title).toBe("Recovered Show");
  });

  test("uses the NTS live API channel matching the stream path", async () => {
    const result = await tryNtsLiveApi({
      fetchImpl: async () =>
        json({
          results: [
            { channel_name: "1", now: { broadcast_title: "Channel One" } },
            { channel_name: "2", now: { broadcast_title: "MUTUALISM" } },
          ],
        }),
      streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result?.source).toBe("nts-live-api");
    expect(result?.title).toBe("MUTUALISM");
  });

  test("normalizes Radio BlackOut listening endpoint", async () => {
    const result = await tryRadioBlackoutApi({
      fetchImpl: async () =>
        json({
          title: "B-Rave Ragazze",
          excerpt: "Current show",
          featured_media: "https://radioblackout.org/logo.png",
        }),
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result?.source).toBe("radio-blackout-api");
    expect(result?.title).toBe("B-Rave Ragazze");
    expect(result?.artworkUrl).toBe("https://radioblackout.org/logo.png");
  });
});
