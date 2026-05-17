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
});
