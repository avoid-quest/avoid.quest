import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: dom.window.localStorage,
  navigator: dom.window.navigator,
  sessionStorage: dom.window.sessionStorage,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

let buildNodeSessionFromTemplate: typeof import("@/lib/node-graph/template-sessions")["buildNodeSessionFromTemplate"];
let playbackSessionsCollection: typeof import("@/lib/collections/playback-sessions")["playbackSessionsCollection"];
let resetAllPlaybackRuntime: typeof import("@/lib/stores/playback-runtime-store")["resetAllPlaybackRuntime"];
let setPlaybackChannelRuntime: typeof import("@/lib/stores/playback-runtime-store")["setPlaybackChannelRuntime"];
let setPlaybackChannelPeakLevel: typeof import("@/lib/stores/playback-runtime-store")["setPlaybackChannelPeakLevel"];
let playbackRuntimeStore: typeof import("@/lib/stores/playback-runtime-store")["playbackRuntimeStore"];
let useNodeSession: typeof import("./use-node-session")["useNodeSession"];

beforeAll(async () => {
  ({ buildNodeSessionFromTemplate } = await import(
    "@/lib/node-graph/template-sessions"
  ));
  ({ playbackSessionsCollection } = await import(
    "@/lib/collections/playback-sessions"
  ));
  ({
    resetAllPlaybackRuntime,
    setPlaybackChannelRuntime,
    setPlaybackChannelPeakLevel,
    playbackRuntimeStore,
  } = await import("@/lib/stores/playback-runtime-store"));
  ({ useNodeSession } = await import("./use-node-session"));
});

beforeEach(async () => {
  await playbackSessionsCollection.stateWhenReady();
  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
  resetAllPlaybackRuntime();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("useNodeSession", () => {
  test("adds a paused source and updates its controls without runtime changes", async () => {
    const station = {
      id: "station",
      name: "Station",
      streamUrl: "https://radio.example/station.mp3",
    };
    const file = {
      id: "file",
      name: "Review tone",
      streamUrl: "blob:https://radio.test/review-tone",
    };
    playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("start-from-multiple", {
        session: [station],
      })
    );
    const { result } = renderHook(() => useNodeSession());
    await waitFor(() => expect(result.current.sources).toHaveLength(1));
    const runtimeBefore = playbackRuntimeStore.state;
    const expanded = buildNodeSessionFromTemplate("start-from-multiple", {
      session: [station, file],
    });

    act(() => {
      playbackSessionsCollection.update("node", (session) => {
        session.channels = expanded.channels;
        session.graph = expanded.graph;
      });
    });
    await waitFor(() => expect(result.current.sources).toHaveLength(2));
    expect(result.current.sources[1]).toMatchObject({
      id: "src-file",
      isLoading: false,
      isPlaying: false,
      radio: file,
    });

    act(() => {
      playbackSessionsCollection.update("node", (session) => {
        const added = session.channels.find(
          (channel) => channel.id === "n:src-file"
        );
        if (added) {
          added.volume = 0.4;
          added.muted = true;
        }
      });
    });
    await waitFor(() => {
      expect(result.current.sources[1]).toMatchObject({
        isMuted: true,
        volume: 0.4,
      });
    });
    expect(playbackRuntimeStore.state).toBe(runtimeBefore);
  });

  test("ignores meter ticks and unrelated channels while observing source changes", async () => {
    const station = {
      id: "metered",
      name: "Metered Station",
      streamUrl: "https://radio.example/metered.mp3",
    };
    playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("start-from-multiple", {
        session: [station],
      })
    );
    const channelId = "n:src-metered";
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useNodeSession();
    });
    await waitFor(() => expect(result.current.sources).toHaveLength(1));
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
      setPlaybackChannelRuntime("left", () => ({ isPlaying: true }));
      setPlaybackChannelRuntime("n:removed", () => ({ isPlaying: true }));
    });
    expect(renders - initialRenders).toBe(0);

    act(() => {
      setPlaybackChannelRuntime(channelId, () => ({ isLoading: true }));
    });
    expect(result.current.sources[0]?.isLoading).toBe(true);
    act(() => {
      setPlaybackChannelRuntime(channelId, () => ({
        isLoading: false,
        isPlaying: true,
      }));
    });
    expect(result.current.sources[0]).toMatchObject({
      isLoading: false,
      isPlaying: true,
    });
    expect(result.current.playingCount).toBe(1);
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
    expect(result.current.sources[0]?.error).toBe("The stream stopped");
    expect(renders - initialRenders).toBe(3);

    act(() => {
      playbackSessionsCollection.update("node", (session) => {
        session.channels = [];
      });
    });
    await waitFor(() => expect(result.current.sources).toEqual([]));
    const emptyRenders = renders;
    act(() => {
      setPlaybackChannelRuntime(channelId, () => ({ isPlaying: false }));
    });
    expect(renders).toBe(emptyRenders);
  });

  test("reads the node session's lanes by Station node id", async () => {
    const quiet = {
      id: "quiet",
      name: "Quiet Station",
      streamUrl: "https://radio.example/quiet.mp3",
    };
    const loud = {
      id: "loud",
      name: "Loud Station",
      streamUrl: "https://radio.example/loud.mp3",
    };
    playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("start-from-multiple", {
        levels: (radio) =>
          radio.id === "quiet" ? { muted: true, volume: 0.35 } : undefined,
        masterVolume: 0.5,
        session: [quiet, loud],
      })
    );
    setPlaybackChannelRuntime("n:src-loud", () => ({ isPlaying: true }));

    const { result } = renderHook(() => useNodeSession());

    await waitFor(() => expect(result.current.sources).toHaveLength(2));
    expect(result.current.sources[0]).toMatchObject({
      channelId: "n:src-quiet",
      id: "src-quiet",
      isMuted: true,
      isPlaying: false,
      radio: quiet,
      volume: 0.35,
    });
    expect(result.current.sources[1]).toMatchObject({
      id: "src-loud",
      isMuted: false,
      isPlaying: true,
    });
    expect(result.current.playingCount).toBe(1);
    expect(result.current.masterVolume).toBe(0.5);
    expect(result.current.graph?.nodes.map((node) => node.id)).toEqual([
      "src-quiet",
      "src-loud",
      "speakers",
    ]);
  });

  test("is empty without a node session", async () => {
    const { result } = renderHook(() => useNodeSession());

    await waitFor(() => expect(result.current.session).toBeUndefined());
    expect(result.current.sources).toEqual([]);
    expect(result.current.graph).toBeNull();
    expect(result.current.masterMuted).toBe(false);
  });
});
