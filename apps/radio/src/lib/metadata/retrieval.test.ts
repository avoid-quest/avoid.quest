import { describe, expect, test } from "bun:test";
import { createRadioMetadataRetrieval } from "./retrieval";
import { createMetadataUpstreamFetch } from "./upstream-fetch";

function jsonResponse(data: unknown): Response {
  return Response.json(data);
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
      ok: true,
      data: {
        source: "icecast-status-json",
        artist: "Artist",
        title: "Title",
      },
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
      ok: true,
      data: {
        source: "airtime-live-info",
        artist: "Artist",
        title: "Title",
      },
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
      ok: true,
      data: {
        source: "azuracast-now-playing",
        artist: "Artist",
        title: "Title",
      },
    });
    expect(calls).toEqual(["https://metadata.example/api/nowplaying/main"]);
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
      url: "https://metadata.example/stats?sid=2&json=1",
      sid: "2",
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        source: "shoutcast-status",
        artist: "Artist",
        title: "Title",
      },
    });
    expect(calls).toEqual(["https://metadata.example/stats?sid=2&json=1"]);
  });
});
