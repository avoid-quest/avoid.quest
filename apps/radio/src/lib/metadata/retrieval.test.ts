import { describe, expect, test } from "bun:test";
import { createRadioMetadataRetrieval } from "./retrieval";
import { createMetadataUpstreamFetch } from "./upstream-fetch";

function jsonResponse(data: unknown): Response {
  return Response.json(data);
}

function icyResponse(rawTitle: string, metaInt = 4): Response {
  const metadata = new TextEncoder().encode(`StreamTitle='${rawTitle}';`);
  const blockLength = Math.ceil(metadata.byteLength / 16) * 16;
  const body = new Uint8Array(metaInt + 1 + blockLength);
  body.fill(0xff, 0, metaInt);
  body[metaInt] = blockLength / 16;
  body.set(metadata, metaInt + 1);
  return new Response(body, {
    headers: {
      "icy-metaint": String(metaInt),
      "icy-name": "Gatto Misterioso",
    },
  });
}

describe("radio metadata retrieval", () => {
  test("uses configured Icecast status without opening the live audio stream", async () => {
    const calls: string[] = [];
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        if (String(url).endsWith("/status-json.xsl")) {
          return Promise.resolve(
            jsonResponse({
              icestats: {
                source: {
                  listenurl: "https://radio.example/live",
                  title: "Artist - Title",
                },
              },
            })
          );
        }
        throw new Error("live stream should not be opened");
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve("https://radio.example/live", {
      kind: "icecast-status",
    });

    expect(response).toMatchObject({
      data: {
        artist: "Artist",
        source: "icecast-status-json",
        title: "Title",
      },
      ok: true,
    });
    expect(calls).toEqual(["https://radio.example/status-json.xsl"]);
  });

  test("uses configured Airtime endpoint without probing alternatives", async () => {
    const calls: string[] = [];
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        return Promise.resolve(
          jsonResponse({
            tracks: {
              current: {
                metadata: {
                  artist_name: "Artist",
                  track_title: "Title",
                },
              },
            },
          })
        );
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve("https://radio.example/live", {
      kind: "airtime-live-info",
      urls: ["https://metadata.example/live-info"],
    });

    expect(response).toMatchObject({
      data: {
        artist: "Artist",
        source: "airtime-live-info",
        title: "Title",
      },
      ok: true,
    });
    expect(calls).toEqual(["https://metadata.example/live-info"]);
  });

  test("uses configured AzuraCast endpoint without probing alternatives", async () => {
    const calls: string[] = [];
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        return Promise.resolve(
          jsonResponse({
            now_playing: { song: { artist: "Artist", title: "Title" } },
          })
        );
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve("https://radio.example/live", {
      kind: "azuracast-now-playing",
      url: "https://metadata.example/api/nowplaying/main",
    });

    expect(response).toMatchObject({
      data: {
        artist: "Artist",
        source: "azuracast-now-playing",
        title: "Title",
      },
      ok: true,
    });
    expect(calls).toEqual(["https://metadata.example/api/nowplaying/main"]);
  });

  test("falls back to ICY metadata when an external metadata API is unavailable", async () => {
    const calls: string[] = [];
    const streamUrl =
      "https://azuracast.gattomisterioso.top/listen/gatto_misterioso/radio.mp3";
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        if (String(url) === streamUrl) {
          return Promise.resolve(icyResponse("Artist - Fallback Title"));
        }
        return Promise.resolve(
          new Response("<html>Resource Access - Pangolin</html>", {
            headers: { "content-type": "text/html" },
          })
        );
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve(streamUrl, {
      kind: "azuracast-now-playing",
    });

    expect(response).toMatchObject({
      data: {
        artist: "Artist",
        source: "icy",
        stationName: "Gatto Misterioso",
        title: "Fallback Title",
      },
      ok: true,
    });
    expect(calls).toEqual([
      "https://azuracast.gattomisterioso.top/api/nowplaying/gatto_misterioso",
      "https://azuracast.gattomisterioso.top/api/nowplaying",
      streamUrl,
    ]);
  });

  test("falls back to Resonance Extra ICY metadata when its schedule API is unavailable", async () => {
    const calls: string[] = [];
    const streamUrl = "https://stream.resonance.fm/resonance-extra";
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        return Promise.resolve(
          String(url) === streamUrl
            ? icyResponse("Fallback Artist - Fallback Title")
            : new Response(null, { status: 503 })
        );
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve(streamUrl, {
      kind: "resonance-extra-api",
    });

    expect(response).toMatchObject({
      data: {
        artist: "Fallback Artist",
        source: "icy",
        title: "Fallback Title",
      },
      ok: true,
    });
    expect(calls).toEqual([
      "https://x.resonance.fm/api/current_and_upcoming",
      streamUrl,
    ]);
  });

  test("falls back to LYL ICY metadata when its live API is ambiguous", async () => {
    const calls: string[] = [];
    const streamUrl = "https://icecast.lyl.live/live";
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        if (String(url) === streamUrl) {
          return Promise.resolve(icyResponse("LYL Radio - Live"));
        }
        return Promise.resolve(
          jsonResponse({
            data: {
              calendar: [
                {
                  end: "2026-09-03T17:30:00.000Z",
                  slug: "episode-a",
                  start: "2026-09-03T16:30:00.000Z",
                  title: "Episode A",
                  type: "EPISODE",
                },
                {
                  end: "2026-09-03T17:30:00.000Z",
                  slug: "episode-b",
                  start: "2026-09-03T16:30:00.000Z",
                  title: "Episode B",
                  type: "EPISODE",
                },
              ],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "LYL Radio - Live",
              },
            },
          })
        );
      }),
      now: () => Date.parse("2026-09-03T16:45:00.000Z"),
    });

    const response = await retrieval.retrieve(streamUrl, { kind: "lyl-api" });

    expect(response).toMatchObject({
      data: {
        artist: "LYL Radio",
        expiresAt: Date.parse("2026-09-03T16:46:00.000Z"),
        source: "icy",
        title: "Live",
      },
      ok: true,
    });
    expect(calls).toEqual(["https://strapi.lyl.live/graphql", streamUrl]);
  });

  test.each(["EPISODE", "SHOW"])(
    "preserves LYL calendar metadata when %s details time out",
    async (type) => {
      let calls = 0;
      let detailSignal: AbortSignal | null | undefined;
      const retrieval = createRadioMetadataRetrieval({
        fetchFollowingPublicRedirects: createMetadataUpstreamFetch(
          (_url, init) => {
            calls += 1;
            if (calls === 1) {
              return Promise.resolve(
                jsonResponse({
                  data: {
                    calendar: [
                      {
                        artists: "Current Host",
                        end: "2026-09-03T17:30:00.000Z",
                        slug: "current-entry",
                        start: "2026-09-03T16:30:00.000Z",
                        title: "Current Entry",
                        type,
                      },
                    ],
                    onair: {
                      hls: "https://radio.lyl.live/hls/live.m3u8",
                      title: "Current Host - Current Entry",
                    },
                  },
                })
              );
            }
            detailSignal = init?.signal;
            return new Promise((_resolve, reject) => {
              detailSignal?.addEventListener(
                "abort",
                () => reject(detailSignal?.reason),
                { once: true }
              );
            });
          }
        ),
        now: () => Date.parse("2026-09-03T16:45:00.000Z"),
        timeoutMs: 20,
      });

      const response = await retrieval.retrieve(
        "https://icecast.lyl.live/live",
        { kind: "lyl-api" }
      );

      expect(response).toMatchObject({
        data: {
          artist: "Current Host",
          artworkUrl: null,
          genre: null,
          itemUrl: `https://lyl.live/${type === "EPISODE" ? "episode" : "show"}/current-entry`,
          source: "lyl-api",
          stationDescription: null,
          title: "Current Entry",
        },
        ok: true,
      });
      expect(calls).toBe(2);
      expect(detailSignal?.aborted).toBeTrue();
    }
  );

  test("falls back to Radio Alhara ICY metadata when its API is unavailable", async () => {
    const calls: string[] = [];
    const streamUrl = "https://n03.radiojar.com/78cxy6wkxtzuv";
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        return Promise.resolve(
          String(url) === streamUrl
            ? icyResponse("Radio Alhara - Dimkal")
            : new Response(null, { status: 503 })
        );
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve(streamUrl, {
      kind: "radio-alhara-api",
    });

    expect(response).toMatchObject({
      data: {
        artist: "Radio Alhara",
        source: "icy",
        title: "Dimkal",
      },
      ok: true,
    });
    expect(calls).toEqual([
      "https://ch2.radioalhara.net/api/now-playing",
      streamUrl,
    ]);
  });

  test("uses configured SHOUTcast status endpoint without probing alternatives", async () => {
    const calls: string[] = [];
    const retrieval = createRadioMetadataRetrieval({
      fetchFollowingPublicRedirects: createMetadataUpstreamFetch((url) => {
        calls.push(String(url));
        return Promise.resolve(
          jsonResponse({
            songtitle: "Artist - Title",
          })
        );
      }),
      now: () => 1000,
    });

    const response = await retrieval.retrieve("https://radio.example/live", {
      kind: "shoutcast-status",
      sid: "2",
      url: "https://metadata.example/stats?sid=2&json=1",
    });

    expect(response).toMatchObject({
      data: {
        artist: "Artist",
        source: "shoutcast-status",
        title: "Title",
      },
      ok: true,
    });
    expect(calls).toEqual(["https://metadata.example/stats?sid=2&json=1"]);
  });
});
