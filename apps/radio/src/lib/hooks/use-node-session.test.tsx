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
import { renderToString } from "react-dom/server";

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

test("DJ selectors isolate channel strips, mixer fields, media, and tempo", async () => {
  const { createDefaultChannel } = await import(
    "@/lib/collections/playback-sessions"
  );
  const { useDeckA, useDeckB, useMixer, useDjMediaDeck } = await import(
    "./use-dj-state"
  );
  const { useDjTempo } = await import("./use-dj-session");
  await playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [
      createDefaultChannel("deck-a", "deck-a", 0),
      createDefaultChannel("deck-b", "deck-b", 1),
    ],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id: "dj",
    masterVolume: 1,
    tempo: 120,
  }).isPersisted.promise;
  const renders = { a: 0, b: 0, media: 0, mixer: 0, tempo: 0 };
  const a = renderHook(() => {
    renders.a += 1;
    return useDeckA();
  });
  renderHook(() => {
    renders.b += 1;
    return useDeckB();
  });
  renderHook(() => {
    renders.mixer += 1;
    return useMixer();
  });
  renderHook(() => {
    renders.media += 1;
    return useDjMediaDeck("deck-a");
  });
  renderHook(() => {
    renders.tempo += 1;
    return useDjTempo();
  });
  const before = { ...renders };
  await act(async () => {
    await playbackSessionsCollection.update("dj", (session) => {
      const [channel] = session.channels;
      if (channel) {
        channel.volume = 0.3;
        channel.pan = 0.4;
      }
    }).isPersisted.promise;
  });
  expect(a.result.current).toMatchObject({ pan: 0.4, volume: 0.3 });
  expect(renders.a).toBeGreaterThan(before.a);
  expect(renders.b).toBe(before.b);
  expect(renders.mixer).toBe(before.mixer);
  expect(renders.media).toBe(before.media);
  expect(renders.tempo).toBe(before.tempo);
  const afterStrip = { ...renders };
  await act(async () => {
    await playbackSessionsCollection.update("dj", (session) => {
      session.crossfadePosition = 0.8;
    }).isPersisted.promise;
  });
  expect(renders.a).toBe(afterStrip.a);
  expect(renders.b).toBe(afterStrip.b);
  expect(renders.mixer).toBeGreaterThan(afterStrip.mixer);
  expect(renders.media).toBe(afterStrip.media);
  expect(renders.tempo).toBe(afterStrip.tempo);
});

test("Node source summaries ignore graph-only edits and master volume", async () => {
  const { useNodeSources, useNodeMaster } = await import("./use-node-session");
  await playbackSessionsCollection.insert(
    buildNodeSessionFromTemplate("starter")
  ).isPersisted.promise;
  let sourceRenders = 0;
  let masterRenders = 0;
  renderHook(() => {
    sourceRenders += 1;
    return useNodeSources();
  });
  const master = renderHook(() => {
    masterRenders += 1;
    return useNodeMaster();
  });
  const beforeSources = sourceRenders;
  const beforeMaster = masterRenders;
  await act(async () => {
    await playbackSessionsCollection.update("node", (session) => {
      const node = session.graph?.nodes.at(0);
      if (node) {
        node.position.x += 1;
      }
    }).isPersisted.promise;
  });
  expect(sourceRenders).toBe(beforeSources);
  expect(masterRenders).toBe(beforeMaster);
  await act(async () => {
    await playbackSessionsCollection.update("node", (session) => {
      session.masterVolume = 0.4;
    }).isPersisted.promise;
  });
  expect(sourceRenders).toBe(beforeSources);
  expect(master.result.current.masterVolume).toBe(0.4);
  expect(masterRenders).toBeGreaterThan(beforeMaster);
});

test("session selectors keep server markup independent of local restored sessions", async () => {
  const { useDjTempo } = await import("./use-dj-session");
  await playbackSessionsCollection.insert({
    ...buildNodeSessionFromTemplate("starter"),
    id: "dj",
    tempo: 145,
  }).isPersisted.promise;
  function Tempo() {
    return <span>{useDjTempo()}</span>;
  }
  expect(renderToString(<Tempo />)).toBe("<span>120</span>");
  const live = renderHook(() => useDjTempo());
  expect(live.result.current).toBe(145);
});
