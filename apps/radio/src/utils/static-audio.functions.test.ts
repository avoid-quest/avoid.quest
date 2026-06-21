import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("cloudflare:workers", () => ({ env: {} }));

let assertPublicStaticAudioUrl: typeof import("./static-audio.functions")["assertPublicStaticAudioUrl"];
let fetchStaticAudioWithRedirects: typeof import("./static-audio.functions")["fetchStaticAudioWithRedirects"];

beforeAll(async () => {
  ({ assertPublicStaticAudioUrl, fetchStaticAudioWithRedirects } = await import(
    "./static-audio.functions"
  ));
});

function expectStaticAudioUrlError(url: string, code: string): void {
  try {
    assertPublicStaticAudioUrl(url);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(code);
    return;
  }

  throw new Error(`Expected ${url} to fail static audio URL validation`);
}

async function expectStaticAudioFetchError(
  promise: Promise<Response>,
  code: string
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(code);
    return;
  }

  throw new Error(`Expected static audio fetch to fail with ${code}`);
}

describe("assertPublicStaticAudioUrl", () => {
  test("rejects normalized private and internal stream URL forms", () => {
    expectStaticAudioUrlError(
      "http://radio.localhost/live.mp3",
      "STATIC_AUDIO_PRIVATE_ADDRESS"
    );
    expectStaticAudioUrlError(
      "http://metadata.google.internal./x.mp3",
      "STATIC_AUDIO_PRIVATE_ADDRESS"
    );
    expectStaticAudioUrlError(
      "http://[::ffff:127.0.0.1]/x.mp3",
      "STATIC_AUDIO_PRIVATE_ADDRESS"
    );
  });

  test("allows public audio URLs", () => {
    expect(() =>
      assertPublicStaticAudioUrl("https://audio.example/live.mp3")
    ).not.toThrow();
  });
});

describe("fetchStaticAudioWithRedirects", () => {
  test("rejects HEAD redirects to loopback addresses before fetching the target", async () => {
    const requestedUrls: string[] = [];
    const methods: Array<string | undefined> = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const initialUrl = "https://audio.example/live.mp3";
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      methods.push(init?.method);
      redirectModes.push(init?.redirect);

      if (url === initialUrl) {
        return Response.redirect("http://127.0.0.1/live.mp3", 302);
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    await expectStaticAudioFetchError(
      fetchStaticAudioWithRedirects(initialUrl, {
        fetchImpl,
        method: "HEAD",
      }),
      "STATIC_AUDIO_PRIVATE_ADDRESS"
    );

    expect(requestedUrls).toEqual([initialUrl]);
    expect(methods).toEqual(["HEAD"]);
    expect(redirectModes).toEqual(["manual"]);
  });

  test("rejects GET redirects to metadata hosts before fetching the target", async () => {
    const requestedUrls: string[] = [];
    const methods: Array<string | undefined> = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const initialUrl = "https://audio.example/playlist.m3u";
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      methods.push(init?.method);
      redirectModes.push(init?.redirect);

      if (url === initialUrl) {
        return Response.redirect(
          "http://metadata.google.internal/latest/meta-data",
          302
        );
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    await expectStaticAudioFetchError(
      fetchStaticAudioWithRedirects(initialUrl, {
        fetchImpl,
        method: "GET",
      }),
      "STATIC_AUDIO_PRIVATE_ADDRESS"
    );

    expect(requestedUrls).toEqual([initialUrl]);
    expect(methods).toEqual(["GET"]);
    expect(redirectModes).toEqual(["manual"]);
  });

  test("rejects redirect loops at the hop limit", async () => {
    const requestedUrls: string[] = [];
    const methods: Array<string | undefined> = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      methods.push(init?.method);
      redirectModes.push(init?.redirect);
      return Response.redirect(
        `https://audio.example/playlist-${requestedUrls.length}.m3u`,
        302
      );
    });

    await expectStaticAudioFetchError(
      fetchStaticAudioWithRedirects("https://audio.example/playlist.m3u", {
        fetchImpl,
        method: "GET",
      }),
      "STATIC_AUDIO_TOO_MANY_REDIRECTS"
    );

    expect(requestedUrls).toHaveLength(6);
    expect(methods).toEqual(["GET", "GET", "GET", "GET", "GET", "GET"]);
    expect(redirectModes).toEqual([
      "manual",
      "manual",
      "manual",
      "manual",
      "manual",
      "manual",
    ]);
  });
});
