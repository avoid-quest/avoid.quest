import { describe, expect, test } from "bun:test";
import {
  BANDCAMP_CDN_PROXY_CONFIG,
  SOUNDCLOUD_CDN_PROXY_CONFIG,
  validateCdnProxyUrl,
} from "./cdn-proxy-workflow";

describe("validateCdnProxyUrl", () => {
  test("allows Bandcamp CDN hostnames", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://t4.bcbits.com/stream/example.mp3",
      config: BANDCAMP_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://t4.bcbits.com/stream/example.mp3");
    }
  });

  test("rejects Bandcamp substring hostname spoofing", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://evil.example/audio.mp3?u=bcbits.com",
      config: BANDCAMP_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BANDCAMP_PROXY_INVALID_DOMAIN");
      expect(result.error.status).toBe(400);
    }
  });

  test("rejects non-http protocols", () => {
    const result = validateCdnProxyUrl({
      urlParam: "file://t4.bcbits.com/private.mp3",
      config: BANDCAMP_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BANDCAMP_PROXY_INVALID_PROTOCOL");
    }
  });

  test("allows only explicit SoundCloud CDN hostnames", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://cf-media.sndcdn.com/abc.128.mp3",
      config: SOUNDCLOUD_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(true);
  });

  test("rejects SoundCloud page URLs", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://soundcloud.com/artist/track",
      config: SOUNDCLOUD_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SOUNDCLOUD_PROXY_PAGE_URL_NOT_ALLOWED");
    }
  });
});
