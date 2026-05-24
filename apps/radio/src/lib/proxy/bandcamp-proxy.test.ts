import { describe, expect, test } from "bun:test";
import {
  cancelUpstreamBody,
  createBandcampProxyRequestHeaders,
  validateBandcampCdnUrl,
} from "./bandcamp-proxy";

describe("validateBandcampCdnUrl", () => {
  test("accepts Bandcamp CDN hostnames", () => {
    expect(validateBandcampCdnUrl("https://t4.bcbits.com/stream.mp3")).toEqual({
      ok: true,
      url: "https://t4.bcbits.com/stream.mp3",
    });
  });

  test("rejects substring spoofing outside the parsed hostname", () => {
    expect(
      validateBandcampCdnUrl("https://evil.example/audio.mp3?cdn=t4.bcbits.com")
    ).toEqual({ ok: false, reason: "invalid-domain" });
    expect(
      validateBandcampCdnUrl("https://evil.example/t4.bcbits.com/audio.mp3")
    ).toEqual({ ok: false, reason: "invalid-domain" });
  });

  test("rejects non-http protocols before fetch", () => {
    expect(validateBandcampCdnUrl("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "invalid-protocol",
    });
  });
});

describe("cancelUpstreamBody", () => {
  test("cancels an unused upstream response body", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      })
    );

    await cancelUpstreamBody(response);

    expect(cancelled).toBe(true);
  });
});
describe("createBandcampProxyRequestHeaders", () => {
  test("omits Range when the incoming request has no range", () => {
    const headers = new Headers(
      createBandcampProxyRequestHeaders(new Request("https://radio.test/api"))
    );

    expect(headers.get("Referer")).toBe("https://bandcamp.com/");
    expect(headers.has("Range")).toBe(false);
  });

  test("forwards Range when provided", () => {
    const headers = new Headers(
      createBandcampProxyRequestHeaders(
        new Request("https://radio.test/api", {
          headers: { Range: "bytes=100-200" },
        })
      )
    );

    expect(headers.get("Range")).toBe("bytes=100-200");
  });
});
