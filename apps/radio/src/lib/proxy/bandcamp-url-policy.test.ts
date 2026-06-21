import { describe, expect, test } from "bun:test";
import { validateBandcampCdnUrl } from "./bandcamp-url-policy";

function expectInvalidBandcampUrl(
  url: string,
  reason: "invalid-url" | "invalid-protocol" | "invalid-domain"
): void {
  expect(validateBandcampCdnUrl(url)).toEqual({ ok: false, reason });
}

describe("validateBandcampCdnUrl", () => {
  test("allows normalized Bandcamp CDN hostnames", () => {
    expect(validateBandcampCdnUrl("https://t4.bcbits.com/track.mp3").ok).toBe(
      true
    );
    expect(validateBandcampCdnUrl("http://bcbits.com/track.mp3").ok).toBe(true);
    expect(validateBandcampCdnUrl("https://T4.BCBITS.COM./track.mp3").ok).toBe(
      true
    );
  });

  test("rejects hostnames and query strings that only contain bcbits.com", () => {
    expectInvalidBandcampUrl(
      "https://bcbits.com.evil.test/track.mp3",
      "invalid-domain"
    );
    expectInvalidBandcampUrl(
      "https://evil.test/track.mp3?x=bcbits.com",
      "invalid-domain"
    );
  });

  test("rejects unsupported protocols, malformed URLs, and overlong values", () => {
    expectInvalidBandcampUrl(
      "ftp://t4.bcbits.com/track.mp3",
      "invalid-protocol"
    );
    expectInvalidBandcampUrl("not-a-url", "invalid-url");
    expectInvalidBandcampUrl(
      `https://t4.bcbits.com/${"x".repeat(2048)}`,
      "invalid-url"
    );
  });
});
