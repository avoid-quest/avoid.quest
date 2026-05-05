import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AudioEngineFacade,
  type AudioManager,
  AudioManager as AudioManagerClass,
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
  setDeckARepeat,
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
  const context = {
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
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock((error: PlaybackActionError) => {
      reportedErrors.push(error);
    }),
    resetAudioManager: mock(() => undefined),
  } satisfies PlaybackActionContext;

  return { context, audioEngine, reportedErrors };
}

const station: Radio = {
  id: "station-1",
  name: "Station 1",
  streamUrl: "https://radio.example/station.mp3",
};

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
