import { describe, expect, test } from "bun:test";
import cryptkeeper from "./fixtures/cloudcast-cryptkeeper.json";
import {
  decodeMixcloudStreamUrl,
  MIXCLOUD_STREAM_KEY,
  selectMixcloudStream,
} from "./stream";

// Recorded from app.mixcloud.com/graphql on 2026-10-01 (see RESEARCH.md).
const { streamInfo } = cryptkeeper.data.cloudcastLookup;

const PROGRESSIVE_URL =
  "https://dl.mixcloud.stream/secure/c/m4a/64/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a?sig=ZoVzO9AXXMDKP4gxB6y3uQ";
const HLS_URL =
  "https://aod.mixcloud.stream/secure/hls/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a/index.m3u8";

function encode(plain: string): string {
  let xored = "";
  for (let index = 0; index < plain.length; index += 1) {
    xored += String.fromCharCode(
      // biome-ignore lint/suspicious/noBitwiseOperators: mirrors Mixcloud's XOR encoding.
      plain.charCodeAt(index) ^
        MIXCLOUD_STREAM_KEY.charCodeAt(index % MIXCLOUD_STREAM_KEY.length)
    );
  }
  return btoa(xored);
}

describe("decodeMixcloudStreamUrl", () => {
  test("decodes the recorded streamInfo fields", () => {
    expect(decodeMixcloudStreamUrl(streamInfo.url)).toBe(PROGRESSIVE_URL);
    expect(decodeMixcloudStreamUrl(streamInfo.hlsUrl)).toBe(HLS_URL);
    expect(decodeMixcloudStreamUrl(streamInfo.dashUrl)).toBe(
      "https://aod.mixcloud.stream/secure/dash2/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a/manifest.mpd"
    );
  });

  test("returns null for values that are not base64", () => {
    expect(decodeMixcloudStreamUrl("not base64!")).toBeNull();
  });
});

describe("selectMixcloudStream", () => {
  test("prefers progressive by default", () => {
    expect(selectMixcloudStream(streamInfo)).toEqual({
      format: "progressive",
      streamUrl: PROGRESSIVE_URL,
    });
  });

  test("follows the caller's protocol order", () => {
    expect(selectMixcloudStream(streamInfo, ["hls", "progressive"])).toEqual({
      format: "hls",
      streamUrl: HLS_URL,
    });
    expect(
      selectMixcloudStream({ hlsUrl: streamInfo.hlsUrl, url: null }, [
        "progressive",
        "hls",
      ])
    ).toEqual({ format: "hls", streamUrl: HLS_URL });
  });

  test("never returns DASH or a URL off Mixcloud's stream hosts", () => {
    expect(selectMixcloudStream({ dashUrl: streamInfo.dashUrl })).toBeNull();
    expect(
      selectMixcloudStream({
        hlsUrl: encode("https://evil.test/index.m3u8"),
        url: encode("http://dl.mixcloud.stream/a.m4a"),
      })
    ).toBeNull();
    expect(selectMixcloudStream(null)).toBeNull();
  });
});
