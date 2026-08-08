import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import type { AudioManager, AudioState } from "@/lib/audio";
import {
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context.js";
import { waitForStablePlayback } from "./single-radio-transition.js";

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
});
