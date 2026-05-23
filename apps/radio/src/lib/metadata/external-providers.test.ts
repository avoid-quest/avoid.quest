import { describe, expect, test } from "bun:test";
import {
  tryAirtimeLiveInfo,
  tryAzuraCastNowPlaying,
  tryNtsLiveApi,
  tryRadioBlackoutApi,
  tryShoutcastStatus,
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

  test("tries Cashmere Airtime v2 before legacy live-info fallback", async () => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo({
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            tracks: {
              current: {
                name: "V2 Show",
              },
            },
          })
        );
      },
      streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(calls[0]).toBe("https://cashmereradio.airtime.pro/api/live-info-v2");
    expect(result?.title).toBe("V2 Show");
  });

  test("normalizes AzuraCast now-playing API responses", async () => {
    const calls: string[] = [];
    const result = await tryAzuraCastNowPlaying({
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            station: {
              name: "Gatto Misterioso",
              description: "AzuraCast station",
            },
            now_playing: {
              song: {
                artist: "Artist",
                title: "Title",
                art: "https://radio.example/art.jpg",
              },
            },
          })
        );
      },
      streamUrl:
        "https://azuracast.gattomisterioso.top/listen/gatto_misterioso/radio.mp3",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(calls).toEqual([
      "https://azuracast.gattomisterioso.top/api/nowplaying/gatto_misterioso",
    ]);
    expect(result).toMatchObject({
      source: "azuracast-now-playing",
      artist: "Artist",
      title: "Title",
      artworkUrl: "https://radio.example/art.jpg",
      stationName: "Gatto Misterioso",
    });
  });

  test("normalizes SHOUTcast JSON stats responses", async () => {
    const calls: string[] = [];
    const result = await tryShoutcastStatus({
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            songtitle: "Artist - Title",
            servertitle: "SHOUTcast Station",
            servergenre: "Eclectic",
            bitrate: "128",
          })
        );
      },
      streamUrl: "https://shoutcast.example/stream",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(calls).toEqual(["https://shoutcast.example/stats?sid=1&json=1"]);
    expect(result).toMatchObject({
      source: "shoutcast-status",
      artist: "Artist",
      title: "Title",
      stationName: "SHOUTcast Station",
      genre: "Eclectic",
      bitrate: 128,
    });
  });

  test("falls back to legacy SHOUTcast 7.html text responses", async () => {
    const calls: string[] = [];
    const result = await tryShoutcastStatus({
      fetchImpl: (url) => {
        calls.push(url);
        if (url.includes("/stats") || url.includes("/currentsong")) {
          return Promise.resolve(new Response("", { status: 404 }));
        }
        return Promise.resolve(new Response("1,1,1,128,1,Artist - Title"));
      },
      streamUrl: "https://shoutcast.example/stream",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(calls).toEqual([
      "https://shoutcast.example/stats?sid=1&json=1",
      "https://shoutcast.example/currentsong?sid=1",
      "https://shoutcast.example/7.html?sid=1",
    ]);
    expect(result).toMatchObject({
      source: "shoutcast-status",
      artist: "Artist",
      title: "Title",
    });
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
