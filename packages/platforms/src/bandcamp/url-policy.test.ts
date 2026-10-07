import { describe, expect, test } from "bun:test";
import { isBandcampCdnHostname, validateBandcampCdnUrl } from "./url-policy";

function expectInvalidBandcampUrl(
  url: string,
  reason: "invalid-url" | "invalid-protocol" | "invalid-domain"
): void {
  expect(validateBandcampCdnUrl(url)).toEqual({ ok: false, reason });
}

describe("validateBandcampCdnUrl", () => {
  test("rejects credentials before a relay can decode them into another host", () => {
    expectInvalidBandcampUrl(
      "https://evil.example%2F@t4.bcbits.com/track.mp3",
      "invalid-url"
    );
    expectInvalidBandcampUrl(
      "https://169.254.169.254%2F@t4.bcbits.com/track.mp3",
      "invalid-url"
    );
  });
  test("allows normalized bcbits CDN hostnames", () => {
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

describe("isBandcampCdnHostname", () => {
  test("uses the shared hostname normalization", () => {
    expect(isBandcampCdnHostname("T4.BCBITS.COM.")).toBe(true);
    expect(isBandcampCdnHostname("bcbits.com.evil.test")).toBe(false);
  });
});
