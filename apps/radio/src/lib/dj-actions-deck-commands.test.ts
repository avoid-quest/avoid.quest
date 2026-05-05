import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AudioEngineFacade,
  type AudioManager,
  AudioManager as AudioManagerClass,
  type AudioState,
  type Radio,
} from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  playbackSessionsCollection,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { deactivateAllChannels } from "./channel-state-manager";
import {
  createDjDeckCommands,
  seekDeckA,
  setDeckAAutoplay,
  setDeckAMute,
  setDeckAPan,
  setDeckARepeat,
  setDeckASpeed,
  setDeckAVolume,
} from "./dj-actions";
import type { PlaybackActionContext } from "./playback-action-context";
import type { PlaybackActionError } from "./playback-action-errors";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertDjSession() {
  playbackSessionsCollection.insert({
    id: "dj",
    channels: [
      createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
      createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
    ],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
  });
}

type AudioEngineFacadeOverrides = {
  playback?: Partial<AudioEngineFacade["playback"]>;
  volume?: Partial<AudioEngineFacade["volume"]>;
};

function createTestAudioEngine(overrides: AudioEngineFacadeOverrides = {}) {
  const base = {
    playback: {
      play: mock(async (_soundId: string, _volume?: number) => undefined),
      pause: mock((_soundId: string) => undefined),
      seek: mock((_soundId: string, _position: number) => undefined),
      refreshStreamUrl: mock(
        async (_soundId: string, _newUrl: string, _seekPosition?: number) =>
          undefined
      ),
    },
    volume: {
      setChannelVolume: mock((_soundId: string, _volume: number) => undefined),
      setMasterVolume: mock((_volume: number) => undefined),
    },
  } satisfies AudioEngineFacade;

  return {
    playback: { ...base.playback, ...overrides.playback },
    volume: { ...base.volume, ...overrides.volume },
  } satisfies AudioEngineFacade;
}

function createTestContext(
  overrides: Partial<AudioManager> = {},
  audioEngineOverrides: AudioEngineFacadeOverrides = {}
) {
  const reportedErrors: PlaybackActionError[] = [];
  const audioEngine = createTestAudioEngine(audioEngineOverrides);
  const context: PlaybackActionContext = {
    audio: {
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setVolume: mock((_soundId: string, _volume: number) => undefined),
      ...overrides,
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate: mock(
        (
          sessionId,
          channelId,
          radio,
          optionsOrSoundId?:
            | string
            | { persistRadio?: boolean; soundId?: string }
        ) => {
          if (
            typeof optionsOrSoundId !== "string" &&
            optionsOrSoundId?.persistRadio
          ) {
            updatePlaybackChannel(sessionId, channelId, (draft) => {
              draft.radio = radio;
            });
          }
          return typeof optionsOrSoundId === "string"
            ? optionsOrSoundId
            : (optionsOrSoundId?.soundId ?? "sound-1");
        }
      ),
      deactivateAll: mock(() => undefined),
      deactivate: mock((_channelId: string) => undefined),
      setVolume: mock((_sessionId, _channelId, _volume) => undefined),
      setMuted: mock((_sessionId, _channelId, _muted) => undefined),
      setPan: mock((_sessionId, _channelId, _pan) => undefined),
      setSpeed: mock((_sessionId, _channelId, _speed) => undefined),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock((error: PlaybackActionError) => {
      reportedErrors.push(error);
    }),
    resetAudioManager: mock(() => undefined),
  };

  return { context, audioEngine, reportedErrors };
}

const station: Radio = {
  id: "station-1",
  name: "Station 1",
  streamUrl: "https://radio.example/station.mp3",
};

async function flushContinuation() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
  deactivateAllChannels();
  AudioManagerClass.resetInstance();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
  deactivateAllChannels();
  AudioManagerClass.resetInstance();
});

describe("DJ deck command context", () => {
  test("loads, plays, pauses, and resets a deck through an injected playback context", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const originalGetInstance = AudioManagerClass.getInstance;
    AudioManagerClass.getInstance = mock(() => {
      throw new Error("AudioManager singleton should not be used");
    }) as typeof AudioManagerClass.getInstance;

    try {
      const { context } = createTestContext();
      const commands = createDjDeckCommands(context);

      await commands.setDeckARadio(station);
      setPlaybackChannelRuntime("deck-a", () => ({
        soundId: "left_station-1",
      }));
      await commands.playDeckA();
      commands.pauseDeckA();
      await commands.resetDeckA();

      expect(context.channels.activate).toHaveBeenCalledWith(
        "dj",
        "deck-a",
        station,
        expect.objectContaining({ soundId: "left_station-1" })
      );
      expect(context.audioEngine.playback.play).toHaveBeenCalledWith(
        "left_station-1",
        1
      );
      expect(context.audioEngine.playback.pause).toHaveBeenCalledWith(
        "left_station-1"
      );
      expect(context.channels.deactivate).toHaveBeenCalledWith("deck-a");
      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(station);
    } finally {
      AudioManagerClass.getInstance = originalGetInstance;
    }
  });

  test("uses the narrow audio engine facade for deck transport and crossfade", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window"
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    const { audioEngine, context } = createTestContext({
      pauseSound: mock(() => {
        throw new Error("legacy pauseSound should not be used");
      }),
      playSound: mock(() =>
        Promise.reject(new Error("legacy playSound should not be used"))
      ),
      setVolume: mock(() => {
        throw new Error("legacy setVolume should not be used");
      }),
    });

    try {
      const commands = createDjDeckCommands(context);

      await commands.setDeckARadio(station);
      setPlaybackChannelRuntime("deck-a", () => ({
        soundId: "left_station-1",
      }));
      await commands.playDeckA();
      commands.pauseDeckA();

      expect(audioEngine.playback.play).toHaveBeenCalledWith(
        "left_station-1",
        1
      );
      expect(audioEngine.playback.pause).toHaveBeenCalledWith("left_station-1");
      expect(audioEngine.volume.setChannelVolume).toHaveBeenCalledWith(
        "left_station-1",
        expect.any(Number)
      );
    } finally {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  test("routes deck volume through the injected channel facade", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const { context } = createTestContext();

    setDeckAVolume(0.27, context);

    expect(context.channels.setVolume).toHaveBeenCalledWith(
      "dj",
      "deck-a",
      0.27
    );
  });

  test("routes deck strip updates through the injected channel facade", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const { context } = createTestContext();

    setDeckAMute(true, context);
    setDeckAPan(-0.2, context);
    setDeckASpeed(1.15, context);

    expect(context.channels.setMuted).toHaveBeenCalledWith(
      "dj",
      "deck-a",
      true
    );
    expect(context.channels.setPan).toHaveBeenCalledWith("dj", "deck-a", -0.2);
    expect(context.channels.setSpeed).toHaveBeenCalledWith(
      "dj",
      "deck-a",
      1.15
    );
  });

  test("persists deck continuation flags through the lifecycle command boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const { context } = createTestContext();

    setDeckARepeat(true, context);
    setDeckAAutoplay(false, context);

    expect(getPlaybackChannel("dj", "deck-a")).toEqual(
      expect.objectContaining({
        repeat: true,
        autoplay: false,
      })
    );
  });

  test("honors an injected null stream resolver without default fallback", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
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
            streamUrl: "yt:next-video",
            videoId: "next-video",
          },
        ],
      },
    };
    const resolveStreamUrl = mock(async () => null);
    const captured = {
      emitAudioState: null as ((audioState: AudioState) => void) | null,
    };
    const { context } = createTestContext();
    context.platformStreams = { resolveStreamUrl };
    const activateWithCapturedState: PlaybackActionContext["channels"]["activate"] =
      (sessionId, channelId, radio, optionsOrSoundId) => {
        const options =
          typeof optionsOrSoundId === "string" ? undefined : optionsOrSoundId;
        const soundId =
          typeof optionsOrSoundId === "string"
            ? optionsOrSoundId
            : (optionsOrSoundId?.soundId ?? "sound-1");

        if (options?.persistRadio) {
          updatePlaybackChannel(sessionId, channelId, (draft) => {
            draft.radio = radio;
          });
        }
        setPlaybackChannelRuntime(channelId, () => ({ soundId }));
        captured.emitAudioState = options?.onAudioState ?? null;
        return soundId;
      };
    context.channels.activate = mock(activateWithCapturedState);
    const commands = createDjDeckCommands(context);

    await commands.setDeckARadio(youtubePlaylist);
    const capturedEmitAudioState = captured.emitAudioState;
    if (!capturedEmitAudioState) {
      throw new Error(
        "Expected deck activation to provide audio state handler"
      );
    }
    capturedEmitAudioState({
      error: null,
      hasEnded: true,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await flushContinuation();

    expect(resolveStreamUrl).toHaveBeenCalledWith({
      platform: "youtube",
      reason: "playlist-next",
      videoId: "next-video",
      radio: youtubePlaylist,
    });
    expect(context.channels.activate).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(youtubePlaylist);
  });

  test("seeks a deck through an injected playback context", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const { audioEngine, context } = createTestContext();
    setPlaybackChannelRuntime("deck-a", () => ({
      soundId: "left_station-1",
    }));

    seekDeckA(42, context);

    expect(audioEngine.playback.seek).toHaveBeenCalledWith(
      "left_station-1",
      42
    );
  });

  test("reports load failures through the shared user-safe playback error model", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const rawError = new Error("network stream handshake leaked vendor detail");
    const { context, reportedErrors } = createTestContext();
    context.channels.activate = mock(() => {
      throw rawError;
    });
    const commands = createDjDeckCommands(context);

    await commands.setDeckARadio(station);

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.userMessage).toBe(
      "The stream could not be reached. Check the station URL and try again."
    );
    expect(reportedErrors[0]?.rawMessage).toBe(rawError.message);
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
  });
});
