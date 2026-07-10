import { describe, expect, mock, test } from "bun:test";
import {
  fetchPublicHttpUrlWithValidatedRedirects,
  type PublicHostnameResolver,
  validatePublicHttpUrl,
  validatePublicHttpUrlParam,
  validateResolvedPublicHttpUrl,
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

  test("allows signed media URLs up to 4096 characters", () => {
    const prefix = "https://media.example/";
    const url = prefix + "x".repeat(4096 - prefix.length);

    expect(validatePublicHttpUrl(url).ok).toBeTrue();
  });

  test("rejects public HTTP URLs longer than 4096 characters", () => {
    const prefix = "https://media.example/";
    const url = prefix + "x".repeat(4097 - prefix.length);

    expect(validatePublicHttpUrl(url)).toEqual({
      ok: false,
      reason: "invalid-url",
    });
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
  test("rejects hostnames that resolve to private addresses before fetching", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Private resolved addresses should not be fetched");
    });
    const resolveHostname = mock(async () => ["127.0.0.1"]);

    await expect(
      fetchPublicHttpUrlWithValidatedRedirects({
        fetchImpl,
        resolveHostname,
        url: "https://radio.example/live.mp3",
      })
    ).resolves.toEqual({
      failure: {
        reason: "internal-address",
        url: "https://radio.example/live.mp3",
      },
      ok: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveHostname).toHaveBeenCalledWith("radio.example", {
      signal: undefined,
    });
  });

  test("rejects redirect targets that resolve to private addresses before fetching them", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);
      return Response.redirect("https://edge.example/live.mp3", 302);
    });
    const resolveHostname: PublicHostnameResolver = mock(async (hostname) =>
      hostname === "radio.example" ? ["93.184.216.34"] : ["10.0.0.1"]
    );

    await expect(
      fetchPublicHttpUrlWithValidatedRedirects({
        fetchImpl,
        resolveHostname,
        url: "https://radio.example/live.mp3",
      })
    ).resolves.toEqual({
      failure: {
        reason: "internal-address",
        url: "https://edge.example/live.mp3",
      },
      ok: false,
    });
    expect(requestedUrls).toEqual(["https://radio.example/live.mp3"]);
  });

  test("fails closed when hostname resolution returns no public addresses", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Unresolved hostnames should not be fetched");
    });

    await expect(
      fetchPublicHttpUrlWithValidatedRedirects({
        fetchImpl,
        resolveHostname: async () => [],
        url: "https://radio.example/live.mp3",
      })
    ).resolves.toEqual({
      failure: {
        reason: "hostname-resolution-failed",
        url: "https://radio.example/live.mp3",
      },
      ok: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

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

describe("validateResolvedPublicHttpUrl", () => {
  test("allows hostnames whose resolved addresses are public", async () => {
    const result = await validateResolvedPublicHttpUrl(
      "https://radio.example/live.mp3",
      {
        resolveHostname: async () => ["93.184.216.34"],
      }
    );

    expect(result.ok).toBeTrue();
  });
});
