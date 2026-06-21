import { describe, expect, mock, test } from "bun:test";
import {
  fetchStaticAudioPlaylistWorkflow,
  getStaticAudioItemWorkflow,
  probeRemoteAudioWorkflow,
} from "./static-audio-workflow";

async function expectStaticAudioWorkflowError(
  promise: Promise<unknown>,
  code: string,
  status: number,
  message?: string
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(code);
    expect((error as { status?: number }).status).toBe(status);
    if (message) {
      expect((error as { safeMessage?: string }).safeMessage).toBe(message);
    }
    return;
  }

  throw new Error(`Expected static audio workflow to fail with ${code}`);
}

describe("probeRemoteAudioWorkflow", () => {
  test("probes remote audio metadata through validated HEAD fetches", async () => {
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      expect(init?.method).toBe("HEAD");
      expect(init?.headers).toEqual({
        "User-Agent": "Mozilla/5.0 (compatible; avoid.quest/1.0)",
      });
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        headers: {
          "content-length": "1234",
          "content-type": "audio/flac",
        },
      });
    });

    await expect(
      probeRemoteAudioWorkflow("https://audio.example/live.flac", {
        fetchImpl,
      })
    ).resolves.toEqual({
      contentLength: 1234,
      contentType: "audio/flac",
      filename: "live",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("fetchStaticAudioPlaylistWorkflow", () => {
  test("fetches and parses playlists against the playlist URL", async () => {
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      expect(init?.method).toBe("GET");
      return new Response("#EXTM3U\n#EXTINF:7,First\ntracks/first.mp3\n");
    });

    await expect(
      fetchStaticAudioPlaylistWorkflow("https://audio.example/list.m3u", {
        fetchImpl,
      })
    ).resolves.toEqual({
      playlist: {
        format: "m3u",
        tracks: [
          {
            duration: 7,
            title: "First",
            url: "https://audio.example/tracks/first.mp3",
          },
        ],
      },
    });
  });
});

describe("getStaticAudioItemWorkflow", () => {
  test("builds playlist metadata from parsed tracks", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response(
        [
          "#EXTM3U",
          "#EXTINF:7,First",
          "tracks/first.mp3",
          "#EXTINF:11,Second",
          "https://cdn.example/second.mp3",
        ].join("\n")
      );
    });

    await expect(
      getStaticAudioItemWorkflow("https://audio.example/list.m3u", {
        fetchImpl,
      })
    ).resolves.toEqual({
      streamUrl: "https://audio.example/tracks/first.mp3",
      metadata: {
        displayName: "list",
        duration: 18,
        fileName: "list",
        fileSize: 0,
        isLocal: false,
        itemType: "playlist",
        mimeType: "audio/x-mpegurl",
        platform: "static-audio",
        playlistFormat: "m3u",
        playlistName: "list",
        requiresProxy: true,
        streamUrl: "https://audio.example/tracks/first.mp3",
        tracks: [
          {
            duration: 7,
            requiresProxy: true,
            streamUrl: "https://audio.example/tracks/first.mp3",
            title: "First",
          },
          {
            duration: 11,
            requiresProxy: true,
            streamUrl: "https://cdn.example/second.mp3",
            title: "Second",
          },
        ],
        url: "https://audio.example/list.m3u",
      },
    });
  });

  test("preserves playlist failure wrapping from the server-function path", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("nope", {
        status: 500,
        statusText: "Origin Error",
      });
    });

    await expectStaticAudioWorkflowError(
      getStaticAudioItemWorkflow("https://audio.example/list.m3u", {
        fetchImpl,
      }),
      "STATIC_AUDIO_PLAYLIST_RESOLVE_FAILED",
      502,
      "HTTP 500: Origin Error"
    );
  });

  test("preserves probe failure wrapping from the server-function path", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response(null, {
        status: 404,
        statusText: "Not Found",
      });
    });

    await expectStaticAudioWorkflowError(
      getStaticAudioItemWorkflow("https://audio.example/missing.mp3", {
        fetchImpl,
      }),
      "STATIC_AUDIO_PROBE_FAILED",
      502,
      "HTTP 404: Not Found"
    );
  });
});
