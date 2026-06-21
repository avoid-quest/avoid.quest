import { describe, expect, mock, test } from "bun:test";
import {
  fetchPublicHttpUrlWithValidatedRedirects,
  validatePublicHttpUrl,
  validatePublicHttpUrlParam,
} from "./public-http-url";

function expectInternalAddress(url: string): void {
  expect(validatePublicHttpUrl(url)).toEqual({
    ok: false,
    reason: "internal-address",
  });
}

describe("validatePublicHttpUrl", () => {
  test("rejects normalized local hostnames", () => {
    expectInternalAddress("http://localhost./stream");
    expectInternalAddress("http://radio.localhost/stream");
    expectInternalAddress("https://radio.local./stream");
    expectInternalAddress(
      "https://metadata.google.internal./computeMetadata/v1"
    );
  });

  test("rejects private IPv4 addresses", () => {
    expectInternalAddress("http://127.0.0.1/stream");
    expectInternalAddress("http://10.0.0.1/stream");
    expectInternalAddress("http://172.16.0.1/stream");
    expectInternalAddress("http://172.31.255.255/stream");
    expectInternalAddress("http://192.168.1.1/stream");
    expectInternalAddress("http://169.254.169.254/latest/meta-data");
  });

  test("rejects private IPv6 and IPv4-mapped IPv6 addresses", () => {
    expectInternalAddress("http://[::1]/stream");
    expectInternalAddress("http://[fe80::1]/stream");
    expectInternalAddress("http://[fc00::1]/stream");
    expectInternalAddress("http://[::ffff:127.0.0.1]/stream");
    expectInternalAddress("http://[::ffff:7f00:1]/stream");
  });

  test("allows public HTTP URLs", () => {
    const result = validatePublicHttpUrl("https://radio.example/live.mp3");
    expect(result.ok).toBeTrue();
  });
});

describe("validatePublicHttpUrlParam", () => {
  test("keeps missing request parameters on the request validation path", () => {
    expect(validatePublicHttpUrlParam(null)).toEqual({
      ok: false,
      reason: "required",
    });
  });
});

describe("fetchPublicHttpUrlWithValidatedRedirects", () => {
  test("maps empty concrete fetch URLs to invalid URL without fetching", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Empty public HTTP URLs should not be fetched");
    });

    await expect(
      fetchPublicHttpUrlWithValidatedRedirects({
        fetchImpl,
        url: "",
      })
    ).resolves.toEqual({
      failure: {
        reason: "invalid-url",
        url: "",
      },
      ok: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
