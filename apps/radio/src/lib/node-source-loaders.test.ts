import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { forgetLocalFileUrls, isLocalFileGone } from "@/lib/node-graph/sources";
import {
  loadLocalFile,
  loadSearchSource,
  loadSourceUrl,
  loadStreamStation,
} from "./node-source-loaders";

afterEach(() => {
  forgetLocalFileUrls();
});

const lazyVideo: Radio = {
  id: "yt-abc",
  name: "A video",
  platformMetadata: {
    itemType: "video",
    platform: "youtube",
    tracks: [{ name: "A video", streamUrl: "yt:abc", videoId: "abc" }],
    url: "https://www.youtube.com/watch?v=abc",
    videoId: "abc",
  },
  streamUrl: "yt:abc",
};

describe("loadSourceUrl", () => {
  test("a pasted YouTube link resolves through the platform loader and its yt: stream", async () => {
    const loadItem = mock(async () => ({
      radio: lazyVideo,
      success: true as const,
    }));
    const resolveStream = mock(async () => ({
      streamFormat: "progressive" as const,
      streamUrl: "https://media.example/abc.m4a",
    }));

    const loaded = await loadSourceUrl("https://youtu.be/abc", {
      loadItem,
      resolveStream,
    });

    expect(loadItem).toHaveBeenCalledWith("https://youtu.be/abc");
    expect(resolveStream).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "initial-load", videoId: "abc" })
    );
    expect(loaded).toEqual({
      radio: expect.objectContaining({
        streamUrl: "https://media.example/abc.m4a",
      }),
    });
  });

  test("a Spotify album on an unmatched track matches it before it plays", async () => {
    const album: Radio = {
      name: "Discovery",
      platformMetadata: {
        itemType: "album",
        platform: "spotify",
        spotifyId: "2noRn2Aes5aoNVsU6iWThc",
        tracks: [
          {
            artist: "Daft Punk",
            name: "Aerodynamic",
            spotifyId: "1NeLwFETswx8Fzxl2AFl91",
            streamUrl: "spotify:track:1NeLwFETswx8Fzxl2AFl91",
            url: "https://open.spotify.com/track/1NeLwFETswx8Fzxl2AFl91",
          },
        ],
        url: "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc",
      },
      streamUrl: "spotify:track:1NeLwFETswx8Fzxl2AFl91",
    };
    const resolveStream = mock(async () => ({
      streamFormat: "progressive" as const,
      streamUrl: "https://media.example/aero.webm",
      youtubeVideoId: "L93-7vRfxNs",
    }));

    const loaded = await loadSourceUrl(
      "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc",
      {
        loadItem: async () => ({ radio: album, success: true as const }),
        resolveStream,
      }
    );

    expect(resolveStream).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "spotify",
        reason: "initial-load",
        spotifyId: "1NeLwFETswx8Fzxl2AFl91",
      })
    );
    expect(loaded).toEqual({
      radio: expect.objectContaining({
        streamUrl: "https://media.example/aero.webm",
      }),
    });
  });

  test("says why a link can't load", async () => {
    const loaded = await loadSourceUrl("https://example.com/page", {
      loadItem: async () => ({
        code: "PLATFORM_UNSUPPORTED_URL",
        error: "Unsupported platform URL",
        success: false,
      }),
    });
    expect(loaded).toEqual({ error: "Unsupported platform URL" });
  });
});

describe("loadLocalFile", () => {
  test("a picked file plays from its object URL in this page", async () => {
    const loaded = await loadLocalFile("file", new File([], "demo.mp3"), {
      loadFile: async () => ({
        displayName: "Demo",
        duration: 10,
        fileName: "demo.mp3",
        fileSize: 100,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/demo",
      }),
    });
    const radio = "radio" in loaded ? loaded.radio : null;
    expect(radio?.name).toBe("Demo");
    expect(isLocalFileGone(radio)).toBe(false);
  });
});

describe("loadStreamStation", () => {
  test("a pasted radio stream becomes a session station", async () => {
    const createSession = mock(async () => ({
      data: {
        radio: {
          name: "stream.example",
          streamUrl: "https://stream.example/live",
        },
      },
      ok: true as const,
    }));

    const loaded = await loadStreamStation("https://stream.example/live", {
      createSession,
    });

    expect(createSession).toHaveBeenCalledWith(
      {
        fields: {
          name: "stream.example",
          streamUrl: "https://stream.example/live",
        },
        origin: "manual",
      },
      { isCurrent: undefined }
    );
    expect(loaded).toEqual({
      radio: {
        id: "stream.example",
        name: "stream.example",
        streamUrl: "https://stream.example/live",
      },
    });
  });
});

describe("loadSearchSource", () => {
  const station: Radio = {
    id: "directory-id",
    name: "Garden",
    streamUrl: "https://stream.example/live",
  };

  test("a directory pick is registered before loading and keeps its session identity", async () => {
    const session = { ...station, id: "session-id" };
    const createSession = mock(async () => ({
      data: { radio: session },
      ok: true as const,
    }));
    const isCurrent = () => true;
    expect(
      await loadSearchSource(station, { createSession, isCurrent })
    ).toEqual({ radio: session });
    expect(createSession).toHaveBeenCalledWith(
      { origin: "discovery", radio: expect.objectContaining(station) },
      { isCurrent }
    );
  });

  test("a matching saved or session station keeps its existing identity", async () => {
    const known = { ...station, id: "saved-id", name: "My station" };
    const createSession = mock(async () => ({
      data: { radio: station },
      ok: true as const,
    }));
    expect(
      await loadSearchSource(station, { createSession, knownRadios: [known] })
    ).toEqual({ radio: known });
    expect(createSession).not.toHaveBeenCalled();
  });

  test("a superseded pick cannot register a station", async () => {
    const createSession = mock(async () => ({
      data: { radio: station },
      ok: true as const,
    }));
    let current = true;
    const pending = loadSearchSource(station, {
      createSession,
      isCurrent: () => current,
    });
    current = false;
    expect(await pending).toEqual({ error: "Station request canceled" });
    expect(createSession).not.toHaveBeenCalled();
  });

  test("a platform track is prepared without becoming a session station", async () => {
    const createSession = mock(async () => ({
      data: { radio: station },
      ok: true as const,
    }));
    const loaded = await loadSearchSource(lazyVideo, {
      createSession,
      resolveStream: async () => ({
        streamFormat: "progressive" as const,
        streamUrl: "https://media.example/abc.m4a",
      }),
    });
    expect(loaded).toMatchObject({
      radio: { streamUrl: "https://media.example/abc.m4a" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
