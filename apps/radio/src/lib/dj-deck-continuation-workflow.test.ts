import { describe, expect, mock, test } from "bun:test";
import type { AudioManager, Radio } from "@/lib/audio";
import type { DeckRecord } from "@/lib/hooks/use-dj-state";
import { createDjDeckContinuationWorkflow } from "./dj-deck-continuation-workflow";

function resolution(
  streamUrl: string,
  streamFormat: Radio["streamFormat"] = "progressive"
) {
  return { streamFormat, streamUrl };
}

const baseRadio: Radio = {
  id: "playlist-1",
  name: "Playlist 1",
  streamUrl: "https://radio.example/current.mp3",
  platformMetadata: {
    platform: "soundcloud",
    itemType: "playlist",
    url: "https://soundcloud.example/playlist",
    name: "Playlist 1",
    artist: "Artist",
    artwork: "",
    trackCount: 2,
    tracks: [
      {
        name: "Current",
        streamUrl: "https://radio.example/current.mp3",
        duration: 120,
      },
      {
        name: "Next",
        streamUrl: "https://radio.example/next.mp3",
        duration: 180,
      },
    ],
  },
};

function createDeck(overrides: Partial<DeckRecord> = {}): DeckRecord {
  return {
    id: "deck-a",
    role: "deck-a",
    radio: baseRadio,
    volume: 0.8,
    muted: false,
    pan: 0,
    speed: 1,
    channelFilter: 0,
    effects: [],
    filter: {
      type: "lowpass",
      frequency: 1000,
      Q: 1,
      gain: 0,
      enabled: false,
    },
    effectsDryWet: 1,
    repeat: false,
    autoplay: true,
    cueEnabled: false,
    order: 0,
    ...overrides,
  };
}

function createDependencies(
  overrides: {
    loadTrack?: (
      deckSide: "left" | "right",
      radio: Radio | null,
      autoPlay?: boolean
    ) => Promise<void>;
    playDeckSound?: (soundId: string, volume: number) => Promise<void>;
    refreshStreamUrl?: (
      soundId: string,
      newUrl: string,
      position?: number
    ) => Promise<void>;
    resolvePlatformStreamUrl?: Parameters<
      typeof createDjDeckContinuationWorkflow
    >[0]["resolvePlatformStreamUrl"];
  } = {}
) {
  const audioManager = {
    refreshStreamUrl: mock(
      overrides.refreshStreamUrl ??
        (async (_soundId: string, _newUrl: string, _position?: number) =>
          undefined)
    ),
  } as unknown as AudioManager;

  return {
    dependencies: {
      applyCrossfade: mock(() => undefined),
      clearDjError: mock(() => undefined),
      getAudioManager: () => audioManager,
      loadTrack: mock(
        overrides.loadTrack ??
          (async (
            _deckSide: "left" | "right",
            _radio: Radio | null,
            _autoPlay?: boolean
          ) => undefined)
      ),
      playDeckSound: mock(
        overrides.playDeckSound ??
          (async (_soundId: string, _volume: number) => undefined)
      ),
      reportDjError: mock(() => undefined),
      reportPlaybackError: mock(() => undefined),
      resolvePlatformStreamUrl: mock(
        overrides.resolvePlatformStreamUrl ??
          (() =>
            Promise.resolve(resolution("https://radio.example/resolved.mp3")))
      ),
      seekDeckSound: mock((_soundId: string, _position: number) => undefined),
    },
    audioManager,
  };
}

describe("DJ deck continuation workflow", () => {
  test("repeat seeks and restarts the current deck sound with crossfade reapplied", async () => {
    const { dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const resetChannelStripFlag = mock(() => undefined);

    await workflow.handleTrackEnded({
      currentDeck: createDeck({ repeat: true }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag,
      soundId: "left_playlist-1",
    });

    expect(dependencies.seekDeckSound).toHaveBeenCalledWith(
      "left_playlist-1",
      0
    );
    expect(dependencies.playDeckSound).toHaveBeenCalledWith(
      "left_playlist-1",
      0.8
    );
    expect(resetChannelStripFlag).toHaveBeenCalledTimes(1);
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });

  test("autoplay advances to the next playlist track when one is available", async () => {
    const { dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);

    await workflow.handleTrackEnded({
      currentDeck: createDeck(),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: "left_playlist-1",
    });

    expect(dependencies.loadTrack).toHaveBeenCalledWith(
      "left",
      expect.objectContaining({
        streamUrl: "https://radio.example/next.mp3",
      }),
      true
    );
  });

  test("autoplay resolves YouTube playlist tracks through the platform adapter", async () => {
    const { dependencies } = createDependencies({
      resolvePlatformStreamUrl: () =>
        Promise.resolve(
          resolution("https://youtube.example/resolved-next.mp3")
        ),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const youtubePlaylist: Radio = {
      id: "youtube-playlist-1",
      name: "YouTube Playlist",
      streamUrl: "https://youtube.example/current.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "playlist",
        url: "https://youtube.example/playlist?list=abc123",
        playlistId: "abc123",
        tracks: [
          {
            name: "Current",
            streamUrl: "https://youtube.example/current.mp3",
            videoId: "current-video",
          },
          {
            name: "Next",
            streamUrl: "",
            videoId: "next-video",
          },
        ],
      },
    };

    await workflow.handleTrackEnded({
      currentDeck: createDeck({ radio: youtubePlaylist }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: "left_youtube-playlist-1",
    });

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      platform: "youtube",
      reason: "playlist-next",
      videoId: "next-video",
      radio: youtubePlaylist,
    });
    expect(dependencies.loadTrack).toHaveBeenCalledWith(
      "left",
      expect.objectContaining({
        streamUrl: "https://youtube.example/resolved-next.mp3",
      }),
      true
    );
  });

  test("autoplay leaves the deck stable when no next playlist track exists", async () => {
    const { dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const oneTrackPlaylist: Radio = {
      id: "playlist-1",
      name: "Playlist 1",
      streamUrl: "https://radio.example/current.mp3",
      platformMetadata: {
        platform: "soundcloud",
        itemType: "playlist",
        url: "https://soundcloud.example/playlist",
        name: "Playlist 1",
        artist: "Artist",
        artwork: "",
        trackCount: 1,
        tracks: [
          {
            name: "Current",
            streamUrl: "https://radio.example/current.mp3",
            duration: 120,
          },
        ],
      },
    };

    await workflow.handleTrackEnded({
      currentDeck: createDeck({
        radio: oneTrackPlaylist,
      }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: "left_playlist-1",
    });

    expect(dependencies.loadTrack).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).not.toHaveBeenCalled();
  });

  test.each([
    {
      current: "https://audio.example/live.m3u8",
      currentFormat: "hls" as const,
      expectedFormat: "progressive" as const,
      next: "https://audio.example/archive.mp3",
    },
    {
      current: "https://audio.example/archive.mp3",
      currentFormat: "progressive" as const,
      expectedFormat: "hls" as const,
      next: "https://audio.example/live.m3u8",
    },
  ])("autoplay changes static playlist format from $currentFormat to $expectedFormat", async ({
    current,
    currentFormat,
    expectedFormat,
    next,
  }) => {
    const { dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const playlist: Radio = {
      id: "static-playlist",
      name: "Static playlist",
      streamFormat: currentFormat,
      streamUrl: current,
      platformMetadata: {
        displayName: "Static playlist",
        duration: 0,
        fileName: "playlist.m3u",
        fileSize: 0,
        isLocal: false,
        itemType: "playlist",
        mimeType: "audio/x-mpegurl",
        platform: "static-audio",
        playlistFormat: "m3u",
        streamUrl: current,
        tracks: [
          { streamUrl: current, title: "Current" },
          { streamUrl: next, title: "Next" },
        ],
        url: "https://audio.example/playlist.m3u",
      },
    };

    await workflow.handleTrackEnded({
      currentDeck: createDeck({ radio: playlist }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: "left_static-playlist",
    });

    expect(dependencies.loadTrack).toHaveBeenCalledWith(
      "left",
      expect.objectContaining({
        streamFormat: expectedFormat,
        streamUrl: next,
      }),
      true
    );
  });

  test.each([
    "bandcamp",
    "soundcloud",
  ] as const)("autoplay honors an extensionless nested %s track format", async (platform) => {
    const { dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const currentUrl = "https://media.example/current.mp3";
    const nextUrl = "https://media.example/extensionless-live";
    const playlist: Radio = {
      id: `${platform}-playlist`,
      name: `${platform} playlist`,
      streamFormat: "progressive",
      streamUrl: currentUrl,
      platformMetadata:
        platform === "soundcloud"
          ? {
              itemType: "playlist",
              platform,
              tracks: [
                { name: "Current", streamUrl: currentUrl },
                { format: "hls", name: "Next", streamUrl: nextUrl },
              ],
              url: "https://soundcloud.com/artist/set",
            }
          : {
              itemType: "album",
              platform,
              tracks: [
                { name: "Current", streamUrl: currentUrl },
                { format: "hls", name: "Next", streamUrl: nextUrl },
              ],
              url: "https://artist.bandcamp.com/album/set",
            },
    };

    await workflow.handleTrackEnded({
      currentDeck: createDeck({ radio: playlist }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: `left_${platform}-playlist`,
    });

    expect(dependencies.loadTrack).toHaveBeenCalledWith(
      "left",
      expect.objectContaining({
        streamFormat: "hls",
        streamUrl: nextUrl,
      }),
      true
    );
  });

  test("successful YouTube stream refresh uses the injected platform adapter", async () => {
    const { audioManager, dependencies } = createDependencies({
      resolvePlatformStreamUrl: () =>
        Promise.resolve(resolution("https://youtube.example/fresh.mp3")),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const radio: Radio = {
      id: "youtube-1",
      name: "YouTube 1",
      streamUrl: "https://youtube.example/stale.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=abc123",
        videoId: "abc123",
      },
    };

    await workflow.handleStreamInterrupted({
      deckId: "deck-a",
      currentRadio: radio,
      position: 42,
      soundId: "left_youtube-1",
    });

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      platform: "youtube",
      reason: "stream-refresh",
      videoId: "abc123",
      radio,
    });
    expect(audioManager.refreshStreamUrl).toHaveBeenCalledWith(
      "left_youtube-1",
      "https://youtube.example/fresh.mp3",
      42,
      "progressive"
    );
    expect(dependencies.clearDjError).toHaveBeenCalledWith("deck-a");
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });

  test("does not report refreshed or clear the real error when media reload fails", async () => {
    const mediaError = new Error("media element rejected fresh URL");
    const { dependencies } = createDependencies({
      refreshStreamUrl: () => Promise.reject(mediaError),
      resolvePlatformStreamUrl: () =>
        Promise.resolve(resolution("https://youtube.example/fresh.mp3")),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const radio: Radio = {
      id: "youtube-1",
      name: "YouTube 1",
      streamUrl: "https://youtube.example/stale.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=abc123",
        videoId: "abc123",
      },
    };

    await expect(
      workflow.handleStreamInterrupted({
        deckId: "deck-a",
        currentRadio: radio,
        position: 42,
        soundId: "left_youtube-1",
      })
    ).resolves.toBe("failed");

    expect(dependencies.clearDjError).not.toHaveBeenCalled();
    expect(dependencies.applyCrossfade).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      expect.any(String),
      "DJ_STREAM_REFRESH_FAILED",
      mediaError,
      radio,
      "deck-a"
    );
  });

  test("refreshes an interrupted SoundCloud stream from its canonical platform URL", async () => {
    const { audioManager, dependencies } = createDependencies({
      resolvePlatformStreamUrl: () =>
        Promise.resolve(
          resolution("https://soundcloud-media.example/fresh.mp3")
        ),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const radio: Radio = {
      id: "soundcloud-1",
      name: "SoundCloud 1",
      streamUrl: "https://soundcloud-media.example/expired.mp3",
      platformMetadata: {
        platform: "soundcloud",
        itemType: "track",
        url: "https://soundcloud.com/artist/canonical-track",
      },
    };

    await expect(
      workflow.handleStreamInterrupted({
        deckId: "deck-a",
        currentRadio: radio,
        position: 37,
        soundId: "left_soundcloud-1",
      })
    ).resolves.toBe("refreshed");

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      canonicalUrl: "https://soundcloud.com/artist/canonical-track",
      platform: "soundcloud",
      radio,
      reason: "stream-refresh",
    });
    expect(audioManager.refreshStreamUrl).toHaveBeenCalledWith(
      "left_soundcloud-1",
      "https://soundcloud-media.example/fresh.mp3",
      37,
      "progressive"
    );
  });

  test("passes a refreshed resolver stream format to the media loader", async () => {
    const { audioManager, dependencies } = createDependencies({
      resolvePlatformStreamUrl: () =>
        Promise.resolve(
          resolution("https://soundcloud-media.example/fresh", "hls")
        ),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const radio: Radio = {
      id: "soundcloud-1",
      name: "SoundCloud 1",
      streamUrl: "https://soundcloud-media.example/expired",
      platformMetadata: {
        platform: "soundcloud",
        itemType: "track",
        url: "https://soundcloud.com/artist/canonical-track",
      },
    };

    await workflow.handleStreamInterrupted({
      deckId: "deck-a",
      currentRadio: radio,
      position: 37,
      soundId: "left_soundcloud-1",
    });

    expect(audioManager.refreshStreamUrl).toHaveBeenCalledWith(
      "left_soundcloud-1",
      "https://soundcloud-media.example/fresh",
      37,
      "hls"
    );
  });

  test("refreshes an interrupted Bandcamp stream from its canonical platform URL", async () => {
    const { audioManager, dependencies } = createDependencies({
      resolvePlatformStreamUrl: () =>
        Promise.resolve(resolution("https://bandcamp-media.example/fresh.mp3")),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const radio: Radio = {
      id: "bandcamp-1",
      name: "Bandcamp 1",
      streamUrl: "https://bandcamp-media.example/expired.mp3",
      platformMetadata: {
        platform: "bandcamp",
        itemType: "track",
        url: "https://artist.bandcamp.com/track/canonical-track",
      },
    };

    await expect(
      workflow.handleStreamInterrupted({
        deckId: "deck-a",
        currentRadio: radio,
        position: 21,
        soundId: "left_bandcamp-1",
      })
    ).resolves.toBe("refreshed");

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      canonicalUrl: "https://artist.bandcamp.com/track/canonical-track",
      platform: "bandcamp",
      radio,
      reason: "stream-refresh",
    });
    expect(audioManager.refreshStreamUrl).toHaveBeenCalledWith(
      "left_bandcamp-1",
      "https://bandcamp-media.example/fresh.mp3",
      21,
      "progressive"
    );
  });

  test.each([
    [
      "SoundCloud",
      "soundcloud",
      "https://soundcloud.com/artist/canonical-track",
      "https://soundcloud-media.example/expired.mp3",
      "DJ_SOUNDCLOUD_REFRESH_FAILED",
    ],
    [
      "Bandcamp",
      "bandcamp",
      "https://artist.bandcamp.com/track/canonical-track",
      "https://bandcamp-media.example/expired.mp3",
      "DJ_BANDCAMP_REFRESH_FAILED",
    ],
  ] as const)("keeps an interrupted %s deck unchanged when canonical resolution fails", async (label, platform, canonicalUrl, expiredUrl, failureCode) => {
    const { audioManager, dependencies } = createDependencies({
      resolvePlatformStreamUrl: async () => null,
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const platformMetadata = {
      itemType: "track" as const,
      platform,
      url: canonicalUrl,
    };
    const radio: Radio = {
      id: `${platform}-1`,
      name: `${label} 1`,
      platformMetadata,
      streamUrl: expiredUrl,
    };

    await expect(
      workflow.handleStreamInterrupted({
        deckId: "deck-a",
        currentRadio: radio,
        position: 18,
        soundId: `left_${platform}-1`,
      })
    ).resolves.toBe("failed");

    expect(audioManager.refreshStreamUrl).not.toHaveBeenCalled();
    expect(radio.streamUrl).toBe(expiredUrl);
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      `Failed to refresh ${label} stream - please reload`,
      failureCode,
      undefined,
      radio,
      "deck-a"
    );
  });

  test("leaves Radio Garden interruptions outside canonical stream refresh", async () => {
    const { audioManager, dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);

    await expect(
      workflow.handleStreamInterrupted({
        deckId: "deck-a",
        currentRadio: {
          id: "radio-garden-1",
          name: "Radio Garden",
          streamUrl: "https://station.example/live.mp3",
          platformMetadata: {
            channelId: "channel-1",
            itemType: "channel",
            platform: "radiogarden",
            url: "https://radio.garden/listen/station/channel-1",
          },
        },
        position: 0,
        soundId: "left_radio-garden-1",
      })
    ).resolves.toBe("not-refreshable");

    expect(dependencies.resolvePlatformStreamUrl).not.toHaveBeenCalled();
    expect(audioManager.refreshStreamUrl).not.toHaveBeenCalled();
  });

  test("failed YouTube stream refresh reports the existing reload error", async () => {
    const { dependencies } = createDependencies({
      resolvePlatformStreamUrl: async () => null,
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);

    await workflow.handleStreamInterrupted({
      deckId: "deck-a",
      currentRadio: {
        id: "youtube-1",
        name: "YouTube 1",
        streamUrl: "https://youtube.example/stale.mp3",
        platformMetadata: {
          platform: "youtube",
          itemType: "video",
          url: "https://youtube.example/watch?v=abc123",
          videoId: "abc123",
        },
      },
      position: 42,
      soundId: "left_youtube-1",
    });

    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to refresh YouTube stream - please reload",
      "DJ_YOUTUBE_REFRESH_FAILED",
      undefined,
      expect.objectContaining({ id: "youtube-1" }),
      "deck-a"
    );
  });

  test("continuation load failures report user-safe playback errors", async () => {
    const rawError = new Error("vendor stream token exploded");
    const { dependencies } = createDependencies({
      loadTrack: () => Promise.reject(rawError),
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);

    await workflow.handleTrackEnded({
      currentDeck: createDeck(),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: "left_playlist-1",
    });

    expect(dependencies.reportPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMessage: rawError.message,
        userMessage:
          "The stream could not be reached. Check the station URL and try again.",
      })
    );
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "The stream could not be reached. Check the station URL and try again.",
      "DJ_LOAD_NEXT_TRACK_FAILED",
      rawError,
      expect.objectContaining({ id: "playlist-1" }),
      "deck-a"
    );
  });
});
