import { describe, expect, test } from "bun:test";
import { isAllowedBandcampUrl } from "./bandcamp-proxy-url-validation";

describe("isAllowedBandcampUrl", () => {
  test("accepts valid bcbits CDN subdomains", () => {
    const url = new URL("https://t4.bcbits.com/stream/abc123.mp3");
    expect(isAllowedBandcampUrl(url)).toBeTrue();
  });

  test("rejects hosts that only reference bcbits.com in query string", () => {
    const url = new URL("https://evil.com/?u=bcbits.com");
    expect(isAllowedBandcampUrl(url)).toBeFalse();
  });

  test("rejects deceptive domains", () => {
    const url = new URL("https://bcbits.com.evil.tld/audio/file.mp3");
    expect(isAllowedBandcampUrl(url)).toBeFalse();
  });

  test("rejects non-http protocols", () => {
    const url = new URL("file:///tmp/audio.mp3");
    expect(isAllowedBandcampUrl(url)).toBeFalse();
  });
});
