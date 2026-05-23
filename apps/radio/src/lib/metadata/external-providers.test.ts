import { describe, expect, test } from "bun:test";
import {
  tryAirtimeLiveInfo,
  tryAzuraCastNowPlaying,
  tryNtsLiveApi,
  tryRadioBlackoutApi,
  tryShoutcastStatus,
} from "./external-providers";
import { RadioMetadataValidationError } from "./upstream-fetch";

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
                  album_title: "Guests",
                  info_url: "guests-179-naive",
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
    expect(result?.album).toBe("Guests");
    expect(result?.itemUrl).toBe(
      "https://radio.syg.ma/episodes/guests-179-naive"
    );
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

  test("propagates Airtime aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryAirtimeLiveInfo(
        {
          fetchImpl: () => {
            throw abortError;
          },
          streamUrl: "https://radio.example/audio.mp3",
          sampledAt: 1000,
          expiresAt: 2000,
        },
        ["https://bad.example/live-info", "https://good.example/live-info"]
      )
    ).rejects.toThrow("aborted");
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
                album: "Album",
                genre: "Genre",
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
      album: "Album",
      genre: "Genre",
      stationName: "Gatto Misterioso",
    });
  });

  test("does not default AzuraCast multi-station responses to the first station", async () => {
    const result = await tryAzuraCastNowPlaying({
      fetchImpl: async () =>
        json([
          {
            station: {
              listen_url: "https://azuracast.example/listen/other/radio.mp3",
              name: "Other Station",
            },
            now_playing: { song: { title: "Wrong Station" } },
          },
        ]),
      streamUrl: "https://azuracast.example/listen/right/radio.mp3",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result).toBeNull();
  });

  test("propagates AzuraCast aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryAzuraCastNowPlaying({
        fetchImpl: () => {
          throw abortError;
        },
        streamUrl: "https://azuracast.example/listen/right/radio.mp3",
        sampledAt: 1000,
        expiresAt: 2000,
      })
    ).rejects.toThrow("aborted");
  });

  test("propagates AzuraCast URL validation errors instead of falling back", async () => {
    await expect(
      tryAzuraCastNowPlaying({
        fetchImpl: () => {
          throw new RadioMetadataValidationError("internal-address");
        },
        streamUrl: "https://azuracast.example/listen/right/radio.mp3",
        sampledAt: 1000,
        expiresAt: 2000,
      })
    ).rejects.toBeInstanceOf(RadioMetadataValidationError);
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

  test("keeps comma-containing titles from legacy SHOUTcast 7.html responses", async () => {
    const result = await tryShoutcastStatus({
      fetchImpl: (url) => {
        if (url.includes("/stats") || url.includes("/currentsong")) {
          return Promise.resolve(new Response("", { status: 404 }));
        }
        return Promise.resolve(
          new Response("1,1,1,128,1,Artist - Title, Part Two")
        );
      },
      streamUrl: "https://shoutcast.example/stream",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result).toMatchObject({
      artist: "Artist",
      title: "Title, Part Two",
    });
  });

  test("propagates SHOUTcast aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryShoutcastStatus({
        fetchImpl: () => {
          throw abortError;
        },
        streamUrl: "https://shoutcast.example/stream",
        sampledAt: 1000,
        expiresAt: 2000,
      })
    ).rejects.toThrow("aborted");
  });

  test("uses the NTS live API channel matching the stream path", async () => {
    const result = await tryNtsLiveApi({
      fetchImpl: async () =>
        json({
          results: [
            { channel_name: "1", now: { broadcast_title: "Channel One" } },
            {
              channel_name: "2",
              now: {
                broadcast_title: "MUTUALISM",
                links: [
                  {
                    rel: "details",
                    href: "https://www.nts.live/api/v2/shows/mutualism/episodes/mutualism-1st-january-2026",
                  },
                ],
                embeds: {
                  details: {
                    genres: [{ value: "Experimental" }],
                  },
                },
              },
            },
          ],
        }),
      streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result?.source).toBe("nts-live-api");
    expect(result?.title).toBe("MUTUALISM");
    expect(result?.genre).toBe("Experimental");
    expect(result?.itemUrl).toBe(
      "https://www.nts.live/shows/mutualism/episodes/mutualism-1st-january-2026"
    );
  });

  test("returns null for NTS network failures so ICY fallback can run", async () => {
    const result = await tryNtsLiveApi({
      fetchImpl: () => {
        throw new Error("network failed");
      },
      streamUrl: "https://stream-relay-geo.ntslive.net/stream",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result).toBeNull();
  });

  test("propagates NTS aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryNtsLiveApi({
        fetchImpl: () => {
          throw abortError;
        },
        streamUrl: "https://stream-relay-geo.ntslive.net/stream",
        sampledAt: 1000,
        expiresAt: 2000,
      })
    ).rejects.toThrow("aborted");
  });

  test("normalizes Radio BlackOut listening endpoint", async () => {
    const result = await tryRadioBlackoutApi({
      fetchImpl: async () =>
        json({
          title: "B-Rave Ragazze",
          excerpt: "Current show",
          featured_media: "https://radioblackout.org/logo.png",
          link: "https://radioblackout.org/shows/b-rave-ragazze/",
        }),
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result?.source).toBe("radio-blackout-api");
    expect(result?.title).toBe("B-Rave Ragazze");
    expect(result?.artworkUrl).toBe("https://radioblackout.org/logo.png");
    expect(result?.itemUrl).toBe(
      "https://radioblackout.org/shows/b-rave-ragazze/"
    );
  });

  test("returns null for Radio BlackOut network failures so ICY fallback can run", async () => {
    const result = await tryRadioBlackoutApi({
      fetchImpl: () => {
        throw new Error("network failed");
      },
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      sampledAt: 1000,
      expiresAt: 2000,
    });

    expect(result).toBeNull();
  });

  test("propagates Radio BlackOut URL validation errors", async () => {
    await expect(
      tryRadioBlackoutApi({
        fetchImpl: () => {
          throw new RadioMetadataValidationError("internal-address");
        },
        streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
        sampledAt: 1000,
        expiresAt: 2000,
      })
    ).rejects.toBeInstanceOf(RadioMetadataValidationError);
  });
});
