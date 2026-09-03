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
