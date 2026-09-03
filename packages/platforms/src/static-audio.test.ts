import { describe, expect, test } from "bun:test";
import {
  getFilenameFromUrl,
  isAudioUrl,
  isPlaylistUrl,
  isStaticAudioUrl,
  validatePublicStaticAudioUrl,
} from "./static-audio";

describe("static audio URL policy", () => {
  test("detects audio and playlist URLs by pathname extension", () => {
    expect(isAudioUrl("https://example.com/Mix-01.MP3?download=1")).toBe(true);
    expect(isPlaylistUrl("https://example.com/live/radio.m3u8")).toBe(true);
    expect(isStaticAudioUrl("https://example.com/live/radio.m3u8")).toBe(true);
    expect(isStaticAudioUrl("https://example.com/archive")).toBe(false);
  });

  test("extracts display filenames using the existing cleanup policy", () => {
    expect(
      getFilenameFromUrl("https://example.com/audio/deep_mix-01.mp3")
    ).toBe("deep mix 01");
    expect(getFilenameFromUrl("not a url")).toBe("Unknown");
  });
});

describe("validatePublicStaticAudioUrl", () => {
  test("rejects unsupported static audio paths before public URL resolution", async () => {
    await expect(
      validatePublicStaticAudioUrl("https://audio.example/archive", {
        resolveHostname: () =>
          Promise.reject(
            new Error("Unsupported URLs should not resolve hostnames")
          ),
      })
    ).resolves.toEqual({ ok: false, reason: "unsupported-url" });
  });

  test("rejects private, loopback, link-local, and metadata static audio URLs", async () => {
    const unsafeUrls = [
      "http://127.0.0.1/live.mp3",
      "http://localhost/live.mp3",
      "http://169.254.169.254/latest/meta-data.mp3",
      "http://metadata.google.internal/live.mp3",
      "http://[fe80::1]/live.mp3",
    ];
    await Promise.all(
      unsafeUrls.map(async (url) => {
        await expect(validatePublicStaticAudioUrl(url)).resolves.toEqual({
          ok: false,
          reason: "internal-address",
        });
      })
    );
  });

  test("rejects public hostnames that resolve to private addresses", async () => {
    await expect(
      validatePublicStaticAudioUrl("https://audio.example/live.mp3", {
        resolveHostname: async () => ["10.0.0.12"],
      })
    ).resolves.toEqual({ ok: false, reason: "internal-address" });
  });

  test("allows public static audio URLs with public resolved addresses", async () => {
    const result = await validatePublicStaticAudioUrl(
      "https://audio.example/live.mp3",
      {
        resolveHostname: async () => ["93.184.216.34"],
      }
    );

    expect(result.ok).toBeTrue();
  });
});
