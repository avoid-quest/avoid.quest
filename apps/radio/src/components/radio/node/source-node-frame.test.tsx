import { afterEach, beforeAll, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { laneChannelId } from "@/lib/node-graph/compile";
import {
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  usePlaybackChannelRuntimeView,
} from "@/lib/stores/playback-runtime-store";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  navigator: dom.window.navigator,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

const { act, cleanup, renderHook } = await import("@testing-library/react");
let useSourceLane: typeof import("./source-node-frame")["useSourceLane"];

beforeAll(async () => {
  ({ useSourceLane } = await import("./source-node-frame"));
});

afterEach(() => {
  cleanup();
  resetAllPlaybackRuntime();
});

test("source controls ignore meter ticks while following transport and errors", () => {
  const channelId = laneChannelId("source");
  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    return useSourceLane("source");
  });
  const initialRenders = renders;

  for (let tick = 1; tick <= 30; tick += 1) {
    act(() => {
      setPlaybackChannelPeakLevel(channelId, {
        left: tick / 30,
        right: tick / 60,
      });
    });
  }
  expect(renders - initialRenders).toBe(0);

  act(() => {
    setPlaybackChannelRuntime(channelId, () => ({ isLoading: true }));
  });
  expect(result.current.isLoading).toBe(true);
  act(() => {
    setPlaybackChannelRuntime(channelId, () => ({
      isLoading: false,
      isPlaying: true,
    }));
  });
  expect(result.current.isPlaying).toBe(true);
  expect(result.current.isLoading).toBe(false);
  act(() => {
    setPlaybackChannelRuntime(channelId, () => ({
      error: {
        code: "PLAYBACK_FAILED",
        id: "failure",
        message: "The stream stopped",
        timestamp: 1,
      },
    }));
  });
  expect(result.current.error).toBe("The stream stopped");
  act(() => resetPlaybackChannelRuntime(channelId));
  expect(result.current).toMatchObject({
    error: null,
    isLoading: false,
    isPlaying: false,
  });
  expect(renders - initialRenders).toBe(4);
});

test("the shared control view follows sound replacement and buffering", () => {
  const channelId = laneChannelId("source");
  const { result } = renderHook(() => usePlaybackChannelRuntimeView(channelId));
  expect(result.current).toMatchObject({
    isBuffering: false,
    soundId: null,
  });
  act(() => {
    setPlaybackChannelRuntime(channelId, () => ({ soundId: "first" }));
  });
  expect(result.current.soundId).toBe("first");
  act(() => {
    setPlaybackChannelRuntime(channelId, () => ({ isBuffering: true }));
  });
  expect(result.current.isBuffering).toBe(true);
  act(() => {
    setPlaybackChannelRuntime(channelId, () => ({ soundId: "replacement" }));
  });
  expect(result.current.soundId).toBe("replacement");
});
