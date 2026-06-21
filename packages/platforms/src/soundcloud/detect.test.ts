import { describe, expect, mock, test } from "bun:test";
import {
  detectSoundCloudItemType,
  isSoundCloudUrl,
  needsResolution,
  normalizeSoundCloudUrl,
} from "./detect";
import { resolveShortLink } from "./index";

describe("isSoundCloudUrl", () => {
  test("recognizes standard SoundCloud URLs", () => {
    expect(isSoundCloudUrl("https://soundcloud.com/artist/track")).toBe(true);
    expect(isSoundCloudUrl("https://soundcloud.com/artist")).toBe(true);
    expect(isSoundCloudUrl("https://www.soundcloud.com/artist/track")).toBe(
      true
    );
  });

  test("recognizes SoundCloud short links", () => {
    expect(isSoundCloudUrl("https://on.soundcloud.com/abc123")).toBe(true);
  });

  test("recognizes mobile SoundCloud URLs", () => {
    expect(isSoundCloudUrl("https://m.soundcloud.com/artist/track")).toBe(true);
  });

  test("rejects non-SoundCloud URLs", () => {
    expect(isSoundCloudUrl("https://example.com")).toBe(false);
    expect(isSoundCloudUrl("https://youtube.com/watch?v=abc")).toBe(false);
    expect(isSoundCloudUrl("https://example.com/soundcloud.com/artist")).toBe(
      false
    );
    expect(isSoundCloudUrl("http://127.0.0.1/on.soundcloud.com/abc123")).toBe(
      false
    );
    expect(isSoundCloudUrl("")).toBe(false);
  });
});

describe("needsResolution", () => {
  test("returns true for short links", () => {
    expect(needsResolution("https://on.soundcloud.com/abc123")).toBe(true);
  });

  test("returns false for standard URLs", () => {
    expect(needsResolution("https://soundcloud.com/artist/track")).toBe(false);
  });

  test("returns false when on.soundcloud.com is not the parsed host", () => {
    expect(needsResolution("http://127.0.0.1/on.soundcloud.com/abc123")).toBe(
      false
    );
    expect(needsResolution("https://example.com/on.soundcloud.com/abc")).toBe(
      false
    );
  });
});

describe("resolveShortLink", () => {
  test("rejects non-short-link hosts before fetch", async () => {
    const fetchImpl = mock(async () => new Response(null));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;

    try {
      await expect(
        resolveShortLink("http://127.0.0.1/on.soundcloud.com/abc123")
      ).rejects.toThrow("Invalid SoundCloud short link");
      expect(fetchImpl).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects loopback redirects before fetching the target", async () => {
    const shortUrl = "https://on.soundcloud.com/abc123";
    const requestedUrls: string[] = [];
    const methods: Array<string | undefined> = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      methods.push(init?.method);
      redirectModes.push(init?.redirect);

      if (url === shortUrl) {
        return Response.redirect("http://127.0.0.1/private", 302);
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      await expect(resolveShortLink(shortUrl)).rejects.toThrow(
        "Non-SoundCloud short link redirect target"
      );
      expect(requestedUrls).toEqual([shortUrl]);
      expect(methods).toEqual(["HEAD"]);
      expect(redirectModes).toEqual(["manual"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects metadata host redirects before fetching the target", async () => {
    const shortUrl = "https://on.soundcloud.com/abc123";
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);

      if (url === shortUrl && init?.redirect === "manual") {
        return Response.redirect(
          "http://metadata.google.internal/latest/meta-data",
          302
        );
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      await expect(resolveShortLink(shortUrl)).rejects.toThrow(
        "Non-SoundCloud short link redirect target"
      );
      expect(requestedUrls).toEqual([shortUrl]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects non-SoundCloud redirects before fetching the target", async () => {
    const shortUrl = "https://on.soundcloud.com/abc123";
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);

      if (url === shortUrl && init?.redirect === "manual") {
        return Response.redirect("https://example.com/artist/track", 302);
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      await expect(resolveShortLink(shortUrl)).rejects.toThrow(
        "Non-SoundCloud short link redirect target"
      );
      expect(requestedUrls).toEqual([shortUrl]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("follows SoundCloud redirects and returns the final URL", async () => {
    const shortUrl = "https://on.soundcloud.com/abc123";
    const finalUrl = "https://soundcloud.com/artist/track";
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);

      if (url === shortUrl) {
        return new Response(null, {
          headers: { Location: finalUrl },
          status: 302,
        });
      }

      return new Response(null);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      await expect(resolveShortLink(shortUrl)).resolves.toBe(finalUrl);
      expect(requestedUrls).toEqual([shortUrl, finalUrl]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("normalizeSoundCloudUrl", () => {
  test("converts mobile URL to desktop", () => {
    expect(
      normalizeSoundCloudUrl("https://m.soundcloud.com/artist/track")
    ).toBe("https://soundcloud.com/artist/track");
  });

  test("preserves desktop URLs", () => {
    expect(normalizeSoundCloudUrl("https://soundcloud.com/artist/track")).toBe(
      "https://soundcloud.com/artist/track"
    );
  });
});

describe("detectSoundCloudItemType", () => {
  test("detects playlist/set URLs", () => {
    expect(
      detectSoundCloudItemType("https://soundcloud.com/artist/sets/album-name")
    ).toBe("playlist");
  });

  test("detects track URLs", () => {
    expect(
      detectSoundCloudItemType("https://soundcloud.com/artist/track-name")
    ).toBe("track");
  });

  test("detects user/profile URLs", () => {
    expect(detectSoundCloudItemType("https://soundcloud.com/artist")).toBe(
      "user"
    );
  });

  test("treats bare domain as user", () => {
    expect(detectSoundCloudItemType("https://soundcloud.com")).toBe("user");
  });
});
