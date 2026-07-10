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
  ])("resolves .%s files without a network request", async (ext, mimeType) => {
    const fetchImpl = mock(() =>
      Promise.reject(new Error("audio files must not be probed"))
    );
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
      streamUrl: "https://audio.example/lists/tracks/first.mp3",
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
    ).rejects.toThrow("private track URL");
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
  });
});
