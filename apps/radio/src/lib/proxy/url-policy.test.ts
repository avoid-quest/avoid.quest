import { describe, expect, test } from "bun:test";
import { validatePublicStreamUrl } from "./url-policy";

function expectInternalAddress(url: string): void {
  expect(validatePublicStreamUrl(url)).toEqual({
    ok: false,
    reason: "internal-address",
  });
}

describe("validatePublicStreamUrl", () => {
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
    const result = validatePublicStreamUrl("https://radio.example/live.mp3");
    expect(result.ok).toBeTrue();
  });
});
