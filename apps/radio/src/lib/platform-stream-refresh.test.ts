import { describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  getRefreshRequest,
  radioOnTrack,
  refreshPlatformStream,
} from "./platform-stream-refresh";

const youtube: Radio = {
  id: "yt-1",
  name: "A video",
  platformMetadata: {
    itemType: "video",
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
    videoId: "abc",
  },
  streamUrl: "https://media.example/old.m4a",
};

const playlist: Radio = {
  id: "yt-list",
  name: "A playlist",
  platformMetadata: {
    itemType: "playlist",
    platform: "youtube",
    tracks: [
      {
        name: "One",
        streamUrl: "https://media.example/one.m4a",
        videoId: "one",
      },
      { name: "Two", streamUrl: "yt:two", videoId: "two" },
    ],
    url: "https://www.youtube.com/playlist?list=x",
  },
  streamUrl: "https://media.example/one.m4a",
};

const spotifyAlbum: Radio = {
  id: "sp-album",
  name: "Discovery",
  platformMetadata: {
    itemType: "album",
    platform: "spotify",
    spotifyId: "2noRn2Aes5aoNVsU6iWThc",
    tracks: [
      {
        artist: "Daft Punk",
        name: "One More Time",
        spotifyId: "0DiWol3AO6WpXZgp0goxAV",
        streamUrl: "https://media.example/one.webm",
        url: "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV",
        youtubeVideoId: "FGBhQbmPwH8",
      },
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
  streamUrl: "https://media.example/one.webm",
};

function options(
  overrides: Partial<Parameters<typeof refreshPlatformStream>[3]> = {}
) {
  return {
    isCurrent: () => true,
    onFailed: mock(() => undefined),
    onRefreshed: mock(() => undefined),
    onUnresolved: mock(() => undefined),
    refresh: mock(async () => undefined),
    resolveStream: mock(async () => ({
      streamFormat: "progressive" as const,
      streamUrl: "https://media.example/new.m4a",
    })),
    ...overrides,
  };
}

describe("getRefreshRequest", () => {
  test("renews a YouTube video by its id and a SoundCloud track by its URL", () => {
    expect(getRefreshRequest(youtube)?.resolution).toEqual({
      platform: "youtube",
      radio: youtube,
      reason: "stream-refresh",
      videoId: "abc",
    });
    const soundcloud: Radio = {
      name: "Set",
      platformMetadata: {
        itemType: "track",
        platform: "soundcloud",
        url: "https://soundcloud.com/a/b",
      },
      streamUrl: "https://media.example/sc.mp3",
    };
    expect(getRefreshRequest(soundcloud)?.resolution).toEqual({
      canonicalUrl: "https://soundcloud.com/a/b",
      platform: "soundcloud",
      radio: soundcloud,
      reason: "stream-refresh",
    });
  });

  test("renews a Spotify track from its matched upload, a Mixcloud show by its URL", () => {
    expect(getRefreshRequest(spotifyAlbum)).toEqual({
      failureCode: "DJ_SPOTIFY_REFRESH_FAILED",
      failureMessage: "Failed to refresh Spotify stream - please reload",
      resolution: {
        platform: "youtube",
        radio: spotifyAlbum,
        reason: "stream-refresh",
        videoId: "FGBhQbmPwH8",
      },
    });
    const mixcloud: Radio = {
      name: "Cryptkeeper",
      platformMetadata: {
        itemType: "show",
        platform: "mixcloud",
        url: "https://www.mixcloud.com/dholbach/cryptkeeper/",
      },
      streamUrl: "https://dl.mixcloud.stream/a.m4a?sig=x",
    };
    expect(getRefreshRequest(mixcloud)).toMatchObject({
      failureCode: "DJ_MIXCLOUD_REFRESH_FAILED",
      resolution: {
        canonicalUrl: "https://www.mixcloud.com/dholbach/cryptkeeper/",
        platform: "mixcloud",
        reason: "stream-refresh",
      },
    });
  });

  test("matches a Spotify track again when it has no matched upload", () => {
    const track: Radio = {
      name: "Get Lucky",
      platformMetadata: {
        itemType: "track",
        platform: "spotify",
        spotifyId: "2Foc5Q5nqNiosCNqttzHof",
        url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
      },
      streamUrl: "https://media.example/lucky.webm",
    };
    expect(getRefreshRequest(track)?.resolution).toEqual({
      platform: "spotify",
      radio: track,
      reason: "stream-refresh",
      spotifyId: "2Foc5Q5nqNiosCNqttzHof",
    });
  });

  test("a live station has nothing to renew", () => {
    expect(
      getRefreshRequest({ name: "KEXP", streamUrl: "https://kexp.example" })
    ).toBeNull();
  });
});

describe("refreshPlatformStream", () => {
  test("resumes the sound on the new URL at its position", async () => {
    const refresh = options();
    await refreshPlatformStream(youtube, "sound-1", 42, refresh);
    expect(refresh.refresh).toHaveBeenCalledWith(
      "sound-1",
      "https://media.example/new.m4a",
      42,
      "progressive"
    );
    expect(refresh.onRefreshed).toHaveBeenCalledTimes(1);
  });

  test("says so when the platform gives no new URL", async () => {
    const refresh = options({ resolveStream: mock(async () => null) });
    await refreshPlatformStream(youtube, "sound-1", 42, refresh);
    expect(refresh.refresh).not.toHaveBeenCalled();
    expect(refresh.onUnresolved).toHaveBeenCalledWith(
      expect.objectContaining({
        failureMessage: "Failed to refresh YouTube stream - please reload",
      })
    );
  });

  test("a sound replaced meanwhile hears nothing back", async () => {
    const refresh = options({ isCurrent: () => false });
    await refreshPlatformStream(youtube, "sound-1", 42, refresh);
    expect(refresh.refresh).not.toHaveBeenCalled();
    expect(refresh.onRefreshed).not.toHaveBeenCalled();
    expect(refresh.onFailed).not.toHaveBeenCalled();
  });

  test("reports a refresh that throws", async () => {
    const error = new Error("decode");
    const refresh = options({
      refresh: mock(() => Promise.reject(error)),
    });
    await refreshPlatformStream(youtube, "sound-1", 42, refresh);
    expect(refresh.onFailed).toHaveBeenCalledWith(expect.anything(), error);
  });
});

describe("radioOnTrack", () => {
  test("resolves a yt: track and keeps its URL on the track", async () => {
    const resolveStream = mock(async () => ({
      streamFormat: "progressive" as const,
      streamUrl: "https://media.example/two.m4a",
    }));
    const next = await radioOnTrack(playlist, "yt:two", resolveStream);
    expect(resolveStream).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "playlist-next", videoId: "two" })
    );
    expect(next?.streamUrl).toBe("https://media.example/two.m4a");
    const tracks =
      next?.platformMetadata && "tracks" in next.platformMetadata
        ? next.platformMetadata.tracks
        : [];
    expect(tracks?.[1]?.streamUrl).toBe("https://media.example/two.m4a");
  });

  test("matches a spotify:track: track and keeps its match on the track", async () => {
    const resolveStream = mock(async () => ({
      streamFormat: "progressive" as const,
      streamUrl: "https://media.example/aero.webm",
      youtubeVideoId: "L93-7vRfxNs",
    }));
    const next = await radioOnTrack(
      spotifyAlbum,
      "spotify:track:1NeLwFETswx8Fzxl2AFl91",
      resolveStream
    );
    expect(resolveStream).toHaveBeenCalledWith({
      platform: "spotify",
      radio: spotifyAlbum,
      reason: "playlist-next",
      spotifyId: "1NeLwFETswx8Fzxl2AFl91",
    });
    expect(next?.streamUrl).toBe("https://media.example/aero.webm");
    expect(next).not.toHaveProperty("youtubeVideoId");
    const tracks =
      next?.platformMetadata?.platform === "spotify"
        ? next.platformMetadata.tracks
        : [];
    expect(tracks?.[1]).toMatchObject({
      streamUrl: "https://media.example/aero.webm",
      youtubeVideoId: "L93-7vRfxNs",
    });
    if (!next) {
      throw new Error("Expected the matched track");
    }
    expect(getRefreshRequest(next)?.resolution).toMatchObject({
      platform: "youtube",
      videoId: "L93-7vRfxNs",
    });
  });

  test("an unmatched spotify:track: track does not play", async () => {
    const next = await radioOnTrack(
      spotifyAlbum,
      "spotify:track:1NeLwFETswx8Fzxl2AFl91",
      mock(async () => null)
    );
    expect(next).toBeNull();
  });

  test("a direct track plays as it is", async () => {
    const resolveStream = mock(async () => null);
    const next = await radioOnTrack(
      playlist,
      "https://media.example/one.m4a",
      resolveStream
    );
    expect(resolveStream).not.toHaveBeenCalled();
    expect(next?.streamUrl).toBe("https://media.example/one.m4a");
  });
});
