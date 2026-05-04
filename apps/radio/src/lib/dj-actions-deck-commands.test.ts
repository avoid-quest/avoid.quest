import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioManager, Radio } from "@/lib/audio";
import { AudioManager as AudioManagerClass } from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { deactivateAllChannels } from "./channel-state-manager";
import { createDjDeckCommands } from "./dj-actions";
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

function createTestContext(overrides: Partial<AudioManager> = {}) {
  const reportedErrors: PlaybackActionError[] = [];
  const context = {
    audio: {
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setVolume: mock((_soundId: string, _volume: number) => undefined),
      ...overrides,
    } as unknown as AudioManager,
    channels: {
      activate: mock(
        (
          _sessionId,
          _channelId,
          _radio,
          optionsOrSoundId?: string | { soundId?: string }
        ) =>
          typeof optionsOrSoundId === "string"
            ? optionsOrSoundId
            : (optionsOrSoundId?.soundId ?? "sound-1")
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

  return { context, reportedErrors };
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
      expect(context.audio.playSound).toHaveBeenCalledWith("left_station-1", 1);
      expect(context.audio.pauseSound).toHaveBeenCalledWith("left_station-1");
      expect(context.channels.deactivate).toHaveBeenCalledWith("deck-a");
      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(station);
    } finally {
      AudioManagerClass.getInstance = originalGetInstance;
    }
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
