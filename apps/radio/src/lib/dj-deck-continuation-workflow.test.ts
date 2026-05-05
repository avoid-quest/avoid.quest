import { describe, expect, mock, test } from "bun:test";
import type { AudioManager, Radio } from "@/lib/audio";
import type { DeckRecord } from "@/lib/hooks/use-dj-state";
import { createDjDeckContinuationWorkflow } from "./dj-deck-continuation-workflow";

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
      radio: Radio | null
    ) => Promise<void>;
    playSound?: (soundId: string, volume: number) => Promise<void>;
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
    playSound: mock(
      overrides.playSound ??
        (async (_soundId: string, _volume: number) => undefined)
    ),
    refreshStreamUrl: mock(
      overrides.refreshStreamUrl ??
        (async (_soundId: string, _newUrl: string, _position?: number) =>
          undefined)
    ),
    seekSound: mock((_soundId: string, _position: number) => undefined),
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
      reportDjError: mock(() => undefined),
      reportPlaybackError: mock(() => undefined),
      resolvePlatformStreamUrl: mock(
        overrides.resolvePlatformStreamUrl ??
          (async () => "https://radio.example/resolved.mp3")
      ),
    },
    audioManager,
  };
}

describe("DJ deck continuation workflow", () => {
  test("repeat seeks and restarts the current deck sound with crossfade reapplied", async () => {
    const { audioManager, dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);
    const resetChannelStripFlag = mock(() => undefined);

    await workflow.handleTrackEnded({
      currentDeck: createDeck({ repeat: true }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag,
      soundId: "left_playlist-1",
    });

    expect(audioManager.seekSound).toHaveBeenCalledWith("left_playlist-1", 0);
    expect(audioManager.playSound).toHaveBeenCalledWith("left_playlist-1", 0.8);
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

  test("autoplay leaves the deck stable when no next playlist track exists", async () => {
    const { dependencies } = createDependencies();
    const workflow = createDjDeckContinuationWorkflow(dependencies);

    await workflow.handleTrackEnded({
      currentDeck: createDeck({
        radio: {
          ...baseRadio,
          platformMetadata: {
            ...baseRadio.platformMetadata,
            tracks: [
              {
                name: "Current",
                streamUrl: "https://radio.example/current.mp3",
                duration: 120,
              },
            ],
          },
        } as Radio,
      }),
      deckId: "deck-a",
      deckSide: "left",
      resetChannelStripFlag: mock(() => undefined),
      soundId: "left_playlist-1",
    });

    expect(dependencies.loadTrack).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).not.toHaveBeenCalled();
  });

  test("successful YouTube stream refresh uses the injected platform adapter", async () => {
    const { audioManager, dependencies } = createDependencies({
      resolvePlatformStreamUrl: async () => "https://youtube.example/fresh.mp3",
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
      42
    );
    expect(dependencies.clearDjError).toHaveBeenCalledTimes(1);
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });

  test("failed YouTube stream refresh reports the existing reload error", async () => {
    const { dependencies } = createDependencies({
      resolvePlatformStreamUrl: async () => null,
    });
    const workflow = createDjDeckContinuationWorkflow(dependencies);

    await workflow.handleStreamInterrupted({
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
      expect.objectContaining({ id: "youtube-1" })
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
      expect.objectContaining({ id: "playlist-1" })
    );
  });
});
