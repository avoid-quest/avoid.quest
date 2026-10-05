import { describe, expect, test } from "bun:test";
import {
  isMixcloudPageHostname,
  isMixcloudStreamHostname,
  validateMixcloudStreamUrl,
} from "./url-policy";

function expectInvalidMixcloudStreamUrl(
  url: string | null,
  reason: "required" | "invalid-url" | "invalid-protocol" | "invalid-domain"
): void {
  expect(validateMixcloudStreamUrl(url)).toEqual({ ok: false, reason });
}

describe("validateMixcloudStreamUrl", () => {
  test("allows Mixcloud stream hosts", () => {
    expect(
      validateMixcloudStreamUrl(
        "https://dl.mixcloud.stream/secure/c/m4a/64/a/b.m4a?sig=x"
      ).ok
    ).toBe(true);
    expect(
      validateMixcloudStreamUrl(
        "https://AOD.MIXCLOUD.STREAM./secure/hls/a/b.m4a/index.m3u8"
      ).ok
    ).toBe(true);
  });

  test("rejects page URLs and hostnames that only contain allowed domains", () => {
    expectInvalidMixcloudStreamUrl(
      "https://www.mixcloud.com/dholbach/cryptkeeper/",
      "invalid-domain"
    );
    expectInvalidMixcloudStreamUrl(
      "https://dl.mixcloud.stream.evil.test/a.m4a",
      "invalid-domain"
    );
    expectInvalidMixcloudStreamUrl(
      "https://evil.mixcloud.stream/a.m4a",
      "invalid-domain"
    );
    expectInvalidMixcloudStreamUrl(
      "https://evil.test/a.m4a?u=dl.mixcloud.stream",
      "invalid-domain"
    );
  });

  test("requires HTTPS and a well-formed, bounded URL", () => {
    expectInvalidMixcloudStreamUrl(null, "required");
    expectInvalidMixcloudStreamUrl("", "required");
    expectInvalidMixcloudStreamUrl(
      "http://dl.mixcloud.stream/a.m4a",
      "invalid-protocol"
    );
    expectInvalidMixcloudStreamUrl("not-a-url", "invalid-url");
    expectInvalidMixcloudStreamUrl(
      `https://dl.mixcloud.stream/${"x".repeat(2048)}`,
      "invalid-url"
    );
  });
});

describe("Mixcloud hostname policies", () => {
  test("use the shared hostname normalization", () => {
    expect(isMixcloudPageHostname("WWW.MIXCLOUD.COM.")).toBe(true);
    expect(isMixcloudPageHostname("api.mixcloud.com")).toBe(false);
    expect(isMixcloudStreamHostname("DL.MIXCLOUD.STREAM.")).toBe(true);
    expect(isMixcloudStreamHostname("mixcloud.stream")).toBe(false);
  });
});
