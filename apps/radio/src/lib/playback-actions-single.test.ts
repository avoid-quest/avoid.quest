import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackSession,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow";
import type { PlaybackActionContext } from "./playback-action-context";
import type { PlaybackActionError } from "./playback-action-errors";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function createTestContext(overrides: Partial<AudioManager> = {}) {
  const reportedErrors: PlaybackActionError[] = [];
  const audioEngine = {
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
  const activate = mock(
    (
      _sessionId,
      _channelId,
      _radio,
      optionsOrSoundId?: string | { soundId?: string }
    ) =>
      typeof optionsOrSoundId === "string"
        ? optionsOrSoundId
        : (optionsOrSoundId?.soundId ?? "single:active")
  );
  const context = {
    audio: {
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      ...overrides,
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate,
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
    resumeAudioContext: mock(async () => undefined),
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

    await createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    }).setPlaying(true);

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

    await expect(
      createManagedPlaybackSessionWorkflow("single", {
        ctx: context,
      }).setPlaying(true)
    ).rejects.toMatchObject({
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

  test("restores the playing station when its replacement fails", async () => {
    const currentRadio = {
      id: "working-station",
      name: "Working Station",
      streamUrl: "https://radio.example/working.mp3",
    };
    const replacementRadio = {
      id: "dead-station",
      name: "Dead Station",
      streamUrl: "https://radio.example/dead.mp3",
    };
    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          radio: currentRadio,
          volume: 0.42,
        },
      ],
      masterVolume: 0.75,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
    });
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
      soundId: "single:single-a",
      isPlaying: true,
    }));
    let playAttempt = 0;
    const { context } = createTestContext({
      playSound: mock(() => {
        playAttempt += 1;
        if (playAttempt === 1) {
          return Promise.reject(new Error("replacement unavailable"));
        }
        return Promise.resolve();
      }) as AudioManager["playSound"],
    });
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    await expect(workflow.selectRadio(replacementRadio)).rejects.toMatchObject({
      code: "PLAY_ERROR",
      radio: replacementRadio,
    });

    expect(getPlaybackSession("single")?.channels[0]?.radio).toEqual(
      currentRadio
    );
    expect(context.channels.activate).toHaveBeenLastCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      currentRadio,
      "single:single-a"
    );
    expect(context.audio.playSound).toHaveBeenLastCalledWith(
      "single:single-a",
      0.42
    );

    resetAllPlaybackRuntime();
    await workflow.activate();

    expect(context.channels.activate).toHaveBeenLastCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      currentRadio,
      "single:single-a"
    );
  });
});
