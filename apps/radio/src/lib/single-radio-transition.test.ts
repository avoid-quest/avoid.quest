import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { AudioManager, type AudioState } from "@/lib/audio";
import {
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context.js";
import {
  crossfadeStableIncoming,
  waitForStablePlayback,
} from "./single-radio-transition.js";

const channelId = "single-a";
const soundId = "sound-a";

function createGateContext(): {
  context: PlaybackActionContext;
  publish: (state: AudioState) => void;
} {
  let listener = (_state: AudioState): void => undefined;
  const context = {
    audio: {
      subscribe: mock(
        (_soundId: string, callback: (state: AudioState) => void) => {
          listener = callback;
          return () => undefined;
        }
      ),
    } as unknown as AudioManager,
  } as PlaybackActionContext;
  return { context, publish: (state) => listener(state) };
}

function createTransitionContext(): {
  audio: AudioManager;
  context: PlaybackActionContext;
  publish: (state: AudioState) => void;
  scheduleVolumeCurve: ReturnType<typeof mock>;
  setVolume: ReturnType<typeof mock>;
} {
  const listeners = new Set<(state: AudioState) => void>();
  const scheduleVolumeCurve = mock(
    (_soundId: string, _curve: Float32Array, _duration: number) => undefined
  );
  const setVolume = mock((_soundId: string, _volume: number) => undefined);
  const audio = {
    getSoundVolume: (id: string) => (id === soundId ? 0 : 0.65),
    hasSound: () => true,
    scheduleVolumeCurve,
    setVolume,
    stopSound: mock((_soundId: string) => undefined),
    subscribe: (_soundId: string, listener: (state: AudioState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AudioManager;
  const context = { audio } as PlaybackActionContext;
  return {
    audio,
    context,
    publish: (state) => {
      setPlaybackChannelRuntime(channelId, () => ({ ...state, soundId }));
      for (const listener of listeners) {
        listener(state);
      }
    },
    scheduleVolumeCurve,
    setVolume,
  };
}

function stableState(overrides: Partial<AudioState> = {}): AudioState {
  return {
    error: null,
    hasEnded: false,
    isBuffering: false,
    isLoading: false,
    isPlaying: true,
    volume: 1,
    ...overrides,
  };
}

afterEach(() => {
  jest.useRealTimers();
  resetPlaybackChannelRuntime(channelId);
});

describe("Single stable playback gate", () => {
  test("requires the full continuous stability duration", async () => {
    jest.useFakeTimers();
    setPlaybackChannelRuntime(channelId, () => ({
      ...stableState(),
      soundId,
    }));
    const { context } = createGateContext();
    let settled = false;
    const gate = waitForStablePlayback(
      context,
      channelId,
      soundId,
      new AbortController().signal,
      750
    ).then(() => {
      settled = true;
    });

    jest.advanceTimersByTime(749);
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await gate;
    expect(settled).toBe(true);
  });

  test("restarts the gate after buffering interrupts startup", async () => {
    jest.useFakeTimers();
    setPlaybackChannelRuntime(channelId, () => ({
      ...stableState(),
      soundId,
    }));
    const { context, publish } = createGateContext();
    let settled = false;
    const gate = waitForStablePlayback(
      context,
      channelId,
      soundId,
      new AbortController().signal,
      750
    ).then(() => {
      settled = true;
    });

    jest.advanceTimersByTime(400);
    publish(stableState({ isBuffering: true }));
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(settled).toBe(false);

    publish(stableState());
    jest.advanceTimersByTime(749);
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await gate;
    expect(settled).toBe(true);
  });

  test("restores outgoing audio and re-gates when buffering interrupts a fade", async () => {
    jest.useFakeTimers();
    setPlaybackChannelRuntime(channelId, () => ({
      ...stableState(),
      soundId,
    }));
    const { audio, context, publish, scheduleVolumeCurve, setVolume } =
      createTransitionContext();
    const originalGetInstance = AudioManager.getInstance;
    AudioManager.getInstance = () => audio;

    try {
      let settled = false;
      const transition = crossfadeStableIncoming(
        context,
        channelId,
        soundId,
        "outgoing",
        0.65,
        100,
        50,
        new AbortController().signal
      ).then(() => {
        settled = true;
      });

      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
      expect(scheduleVolumeCurve).toHaveBeenCalledTimes(2);

      publish(stableState({ isBuffering: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(setVolume).toHaveBeenCalledWith("outgoing", 0.65);
      expect(setVolume).toHaveBeenCalledWith(soundId, 0);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(scheduleVolumeCurve).toHaveBeenCalledTimes(2);

      publish(stableState());
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
      expect(scheduleVolumeCurve).toHaveBeenCalledTimes(4);

      jest.advanceTimersByTime(100);
      await transition;
      expect(settled).toBe(true);
    } finally {
      AudioManager.getInstance = originalGetInstance;
    }
  });
});
