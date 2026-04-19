import { describe, expect, test } from "bun:test";
import { getMediaPlaybackCandidates } from "./media-element-playback-source";

describe("getMediaPlaybackCandidates", () => {
  test("prefers the stream proxy for remote non-HLS URLs", () => {
    expect(
      getMediaPlaybackCandidates("https://stream-relay-geo.ntslive.net/stream2")
    ).toEqual([
      "/api/stream-proxy?url=https%3A%2F%2Fstream-relay-geo.ntslive.net%2Fstream2",
    ]);
  });

  test("keeps direct-first ordering for HLS manifests", () => {
    expect(
      getMediaPlaybackCandidates("https://radio.example/live/index.m3u8")
    ).toEqual([
      "https://radio.example/live/index.m3u8",
      "/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive%2Findex.m3u8",
    ]);
  });

  test("does not rewrite same-origin or already proxied URLs", () => {
    expect(getMediaPlaybackCandidates("/audio/local.mp3")).toEqual([
      "/audio/local.mp3",
    ]);
    expect(
      getMediaPlaybackCandidates(
        "/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Fstream"
      )
    ).toEqual(["/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Fstream"]);
  });
});
