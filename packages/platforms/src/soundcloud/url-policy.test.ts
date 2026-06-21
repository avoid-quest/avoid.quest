import { describe, expect, test } from "bun:test";
import { getProxiedSoundCloudUrl } from "./index";
import {
  isSoundCloudCdnHostname,
  isSoundCloudPageHostname,
  validateSoundCloudCdnUrl,
} from "./url-policy";

function expectInvalidSoundCloudUrl(
  url: string,
  reason: "invalid-url" | "invalid-protocol" | "page-url" | "invalid-domain"
): void {
  expect(validateSoundCloudCdnUrl(url)).toEqual({ ok: false, reason });
}

describe("validateSoundCloudCdnUrl", () => {
  test("allows normalized SoundCloud CDN hostnames", () => {
    expect(
      validateSoundCloudCdnUrl("https://cf-media.sndcdn.com/track.mp3").ok
    ).toBe(true);
    expect(
      validateSoundCloudCdnUrl("http://media.soundcloud.com/track.mp3").ok
    ).toBe(true);
    expect(
      validateSoundCloudCdnUrl("https://CF-HLS-MEDIA.SNDCDN.COM./track.m3u8").ok
    ).toBe(true);
  });

  test("rejects page URLs and hostnames that only contain allowed domains", () => {
    expectInvalidSoundCloudUrl(
      "https://soundcloud.com/artist/track",
      "page-url"
    );
    expectInvalidSoundCloudUrl(
      "https://cf-media.sndcdn.com.evil.test/track.mp3",
      "invalid-domain"
    );
    expectInvalidSoundCloudUrl(
      "https://evil.test/track.mp3?x=cf-media.sndcdn.com",
      "invalid-domain"
    );
  });

  test("rejects unsupported protocols, malformed URLs, and overlong values", () => {
    expectInvalidSoundCloudUrl(
      "ftp://cf-media.sndcdn.com/track.mp3",
      "invalid-protocol"
    );
    expectInvalidSoundCloudUrl("not-a-url", "invalid-url");
    expectInvalidSoundCloudUrl(
      `https://cf-media.sndcdn.com/${"x".repeat(2048)}`,
      "invalid-url"
    );
  });
});

describe("SoundCloud hostname policies", () => {
  test("use the shared hostname normalization", () => {
    expect(isSoundCloudCdnHostname("CF-MEDIA.SNDCDN.COM.")).toBe(true);
    expect(isSoundCloudCdnHostname("cf-media.sndcdn.com.evil.test")).toBe(
      false
    );
    expect(isSoundCloudPageHostname("WWW.SOUNDCLOUD.COM.")).toBe(true);
  });
});

describe("getProxiedSoundCloudUrl", () => {
  test("generates proxy URLs only for canonical SoundCloud CDN URLs", () => {
    const cdnUrl = "https://cf-media.sndcdn.com/track.mp3";
    const hlsUrl = "https://cf-hls-media.sndcdn.com/track.m3u8";
    const pageUrl = "https://soundcloud.com/artist/track";
    const spoofedUrl = "https://cf-media.sndcdn.com.evil.test/track.mp3";

    expect(getProxiedSoundCloudUrl(cdnUrl)).toBe(
      `/api/soundcloud-proxy?url=${encodeURIComponent(cdnUrl)}`
    );
    expect(getProxiedSoundCloudUrl(hlsUrl)).toBe(hlsUrl);
    expect(getProxiedSoundCloudUrl(pageUrl)).toBe(pageUrl);
    expect(getProxiedSoundCloudUrl(spoofedUrl)).toBe(spoofedUrl);
  });
});
