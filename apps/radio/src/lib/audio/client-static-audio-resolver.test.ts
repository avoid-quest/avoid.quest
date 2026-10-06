import { describe, expect, mock, test } from "bun:test";
import {
  ClientStaticAudioResolverError,
  resolveClientStaticAudio,
} from "./client-static-audio-resolver";

function playlistResponse(
  body: BodyInit,
  contentType = "audio/x-mpegurl"
): Response {
  return new Response(body, { headers: { "Content-Type": contentType } });
}

describe("resolveClientStaticAudio", () => {
  test.each([
    ["mp3", "audio/mpeg"],
    ["wav", "audio/wav"],
    ["ogg", "audio/ogg"],
    ["flac", "audio/flac"],
    ["m4a", "audio/mp4"],
    ["aac", "audio/aac"],
    ["webm", "audio/webm"],
    ["opus", "audio/ogg"],
  ])("probes and resolves .%s files", async (ext, mimeType) => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toMatchObject({
        credentials: "omit",
        headers: { Accept: "audio/*", Range: "bytes=0-0" },
        method: "GET",
        redirect: "error",
      });
      return Promise.resolve(new Response(null, { status: 206 }));
    });
    const url = `https://audio.example/deep_mix-01.${ext}?token=abc`;

    await expect(resolveClientStaticAudio(url, { fetchImpl })).resolves.toEqual(
      {
        format: "progressive",
        metadata: {
          displayName: "deep mix 01",
          duration: 0,
          fileName: "deep mix 01",
          fileSize: 0,
          isLocal: false,
          itemType: "track",
          mimeType,
          platform: "static-audio",
          streamUrl: url,
          url,
        },
        streamUrl: url,
      }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects direct audio when the no-redirect probe fails", async () => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return Promise.reject(new TypeError("Redirect blocked"));
    });

    await expect(
      resolveClientStaticAudio("https://audio.example/track.mp3", {
        fetchImpl,
      })
    ).rejects.toThrow("Redirect blocked");
  });

  test("rejects an upstream hostname that resolves to a private address", async () => {
    const fetchImpl = mock(() =>
      Promise.reject(new Error("private hosts must not be fetched"))
    );

    await expect(
      resolveClientStaticAudio("https://audio.example/track.mp3", {
        fetchImpl,
        resolveHostname: async () => ["127.0.0.1"],
      })
    ).rejects.toMatchObject({
      category: "validation",
      expected: true,
      message: "Audio URL must resolve to a public host",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects unsupported, non-HTTP, and credential-bearing URLs", async () => {
    await expect(
      resolveClientStaticAudio("https://audio.example/readme.txt")
    ).rejects.toThrow("supported audio file or playlist");
    await expect(
      resolveClientStaticAudio("file:///tmp/track.mp3")
    ).rejects.toThrow("HTTP or HTTPS");
    await expect(
      resolveClientStaticAudio("https://user:secret@audio.example/track.mp3")
    ).rejects.toThrow("must not contain credentials");
  });

  test.each([
    "http://127.0.0.1:8000/track.mp3",
    "http://10.0.0.1/track.mp3",
    "http://192.168.1.10/list.m3u",
    "http://metadata.google.internal/live.mp3",
  ])("rejects private upstream URL %s", async (url) => {
    const fetchImpl = mock(() =>
      Promise.reject(new Error("private URLs must not be fetched"))
    );

    await expect(resolveClientStaticAudio(url, { fetchImpl })).rejects.toThrow(
      "must be public"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("fetches and parses a direct M3U", async () => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      return Promise.resolve(
        playlistResponse(`#EXTM3U
#EXTINF:7,First
tracks/first.mp3
#EXTINF:11,Second
../second.ogg`)
      );
    });

    const result = await resolveClientStaticAudio(
      "https://audio.example/lists/mix.m3u",
      { fetchImpl }
    );

    expect(result).toMatchObject({
      format: "progressive",
      metadata: {
        duration: 18,
        itemType: "playlist",
        playlistFormat: "m3u",
        tracks: [
          {
            duration: 7,
            streamUrl: "https://audio.example/lists/tracks/first.mp3",
            title: "First",
          },
          {
            duration: 11,
            streamUrl: "https://audio.example/second.ogg",
            title: "Second",
          },
        ],
      },
      streamUrl: "https://audio.example/lists/tracks/first.mp3",
    });
  });

  test("parses PLS entries in numeric order", async () => {
    const result = await resolveClientStaticAudio(
      "https://audio.example/lists/list.pls",
      {
        fetchImpl: mock(() =>
          Promise.resolve(
            playlistResponse(
              `[playlist]
File2=../two.ogg
Title2=Two
Length2=22
File1=one.mp3
Title1=One
Length1=11`,
              "audio/x-scpls; charset=utf-8"
            )
          )
        ),
      }
    );

    expect(result.metadata).toMatchObject({
      duration: 33,
      playlistFormat: "pls",
      tracks: [
        { streamUrl: "https://audio.example/lists/one.mp3" },
        { streamUrl: "https://audio.example/two.ogg" },
      ],
    });
  });

  test("treats an HLS manifest as a directly playable track", async () => {
    const result = await resolveClientStaticAudio(
      "https://audio.example/live.m3u8",
      {
        fetchImpl: mock(() =>
          Promise.resolve(
            playlistResponse(
              "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1"
            )
          )
        ),
      }
    );

    expect(result).toMatchObject({
      format: "hls",
      streamUrl: "https://audio.example/live.m3u8",
    });
  });

  test.each([
    ["segment", "#EXTINF:6,\nhttp://127.0.0.1/segment.ts"],
    ["key", '#EXT-X-KEY:METHOD=AES-128,URI="http://10.0.0.1/key"'],
    ["map", '#EXT-X-MAP:URI="http://192.168.1.10/init.mp4"'],
    [
      "rendition",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",URI="http://[::1]/audio.m3u8"',
    ],
    [
      "content steering",
      '#EXT-X-CONTENT-STEERING:SERVER-URI="http://127.0.0.1/steering"',
    ],
  ])("rejects a private HLS %s URL", async (_kind, directive) => {
    await expect(
      resolveClientStaticAudio("https://audio.example/live.m3u8", {
        fetchImpl: mock(() =>
          Promise.resolve(playlistResponse(`#EXTM3U\n${directive}`))
        ),
      })
    ).rejects.toThrow("private resource URL");
  });

  test("accepts relative HLS resource URLs", async () => {
    await expect(
      resolveClientStaticAudio("https://audio.example/live/main.m3u8", {
        fetchImpl: mock(() =>
          Promise.resolve(
            playlistResponse(
              '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/current"\nsegments/one.ts'
            )
          )
        ),
      })
    ).resolves.toMatchObject({ format: "hls" });
  });

  test("rejects private nested tracks from a public playlist", async () => {
    await expect(
      resolveClientStaticAudio("https://audio.example/list.m3u", {
        fetchImpl: mock(() =>
          Promise.resolve(
            playlistResponse(
              "#EXTM3U\n#EXTINF:-1,Private\nhttp://127.0.0.1/audio.mp3"
            )
          )
        ),
      })
    ).rejects.toThrow("private resource URL");
  });

  test("rejects a playlist resource hostname that resolves privately", async () => {
    await expect(
      resolveClientStaticAudio("https://audio.example/list.m3u", {
        fetchImpl: mock(() =>
          Promise.resolve(
            playlistResponse(
              "#EXTM3U\n#EXTINF:-1,Private\nhttps://media.example/audio.mp3"
            )
          )
        ),
        resolveHostname: async (hostname) =>
          hostname === "media.example" ? ["10.0.0.8"] : ["203.0.113.8"],
      })
    ).rejects.toThrow("private resource URL");
  });

  test("bounds hostname resolution by the resolver timeout", async () => {
    const fetchImpl = mock(() =>
      Promise.reject(new Error("timed-out hosts must not be fetched"))
    );

    await expect(
      resolveClientStaticAudio("https://audio.example/track.mp3", {
        fetchImpl,
        resolveHostname: () => new Promise(() => undefined),
        timeoutMs: 1,
      })
    ).rejects.toThrow("timed out");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects playlists with excessive resource counts", async () => {
    const tracks = Array.from(
      { length: 1001 },
      (_, index) => `https://media.example/${index}.mp3`
    ).join("\n");

    await expect(
      resolveClientStaticAudio("https://audio.example/list.m3u", {
        fetchImpl: mock(() =>
          Promise.resolve(playlistResponse(`#EXTM3U\n${tracks}`))
        ),
        resolveHostname: async () => ["203.0.113.8"],
      })
    ).rejects.toThrow("too many resources");
  });

  test("enforces response type and size limits", async () => {
    await expect(
      resolveClientStaticAudio("https://audio.example/list.m3u", {
        fetchImpl: mock(() =>
          Promise.resolve(playlistResponse("<html></html>", "text/html"))
        ),
      })
    ).rejects.toThrow("Unexpected playlist content type");

    await expect(
      resolveClientStaticAudio("https://audio.example/list.m3u", {
        fetchImpl: mock(() =>
          Promise.resolve(playlistResponse("#EXTM3U\n".padEnd(128, "x")))
        ),
        maxResponseBytes: 32,
      })
    ).rejects.toThrow("exceeds 32 bytes");
  });

  test("reports timeout and caller aborts", async () => {
    const never = () => new Promise<Response>(() => undefined);
    await expect(
      resolveClientStaticAudio("https://audio.example/list.m3u", {
        fetchImpl: never,
        timeoutMs: 1,
      })
    ).rejects.toThrow("timed out");

    const controller = new AbortController();
    const pending = resolveClientStaticAudio("https://audio.example/list.m3u", {
      fetchImpl: never,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(
      ClientStaticAudioResolverError
    );
    await expect(pending).rejects.toMatchObject({
      category: "cancellation",
      expected: true,
    });
  });
});
