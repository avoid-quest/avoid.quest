import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioManager } from "@/lib/audio";
import {
  createDefaultChannel,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context";
import type { PlaybackActionError } from "./playback-action-errors";
import { setSinglePlaybackState } from "./playback-actions-single";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function createTestContext(overrides: Partial<AudioManager> = {}) {
  const reportedErrors: PlaybackActionError[] = [];
  const activate = mock(
    (
      _sessionId,
      _channelId,
      _radio,
      optionsOrSoundId?: string | { soundId?: string }
    ) => {
      return typeof optionsOrSoundId === "string"
        ? optionsOrSoundId
        : (optionsOrSoundId?.soundId ?? "single:active");
    }
  );
  const context = {
    audio: {
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      ...overrides,
    } as unknown as AudioManager,
    channels: {
      activate,
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

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

describe("single playback actions", () => {
  test("plays through the injected action context", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          radio: {
            id: "station-1",
            name: "Station 1",
            streamUrl: "https://radio.example/station.mp3",
          },
          volume: 0.42,
        },
      ],
      masterVolume: 0.75,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
    });

    const { context } = createTestContext();

    await setSinglePlaybackState(true, context);

    expect(context.channels.activate).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/station.mp3",
      },
      "single:single-a"
    );
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.75);
    expect(context.audio.playSound).toHaveBeenCalledWith(
      "single:single-a",
      0.42
    );
  });

  test("reports safe playback errors without exposing raw browser messages", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          radio: {
            id: "station-1",
            name: "Station 1",
            streamUrl: "https://radio.example/station.mp3",
          },
        },
      ],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
    });
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
      soundId: "sound-1",
    }));
    const rawError = new Error(
      "Failed to execute 'linearRampToValueAtTime' on 'AudioParam'"
    );
    const { context, reportedErrors } = createTestContext({
      playSound: mock(() =>
        Promise.reject(rawError)
      ) as AudioManager["playSound"],
    });

    await expect(setSinglePlaybackState(true, context)).rejects.toMatchObject({
      userMessage:
        "Playback could not start. Check the station stream and try again.",
      rawMessage: "Failed to execute 'linearRampToValueAtTime' on 'AudioParam'",
    });

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.userMessage).toBe(
      "Playback could not start. Check the station stream and try again."
    );
    expect(reportedErrors[0]?.rawMessage).toBe(rawError.message);
  });
});
