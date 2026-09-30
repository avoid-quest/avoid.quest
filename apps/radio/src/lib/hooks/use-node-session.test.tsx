import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
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

let buildNodeSessionFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeSessionFromTemplate"];
let playbackSessionsCollection: typeof import("@/lib/collections/playback-sessions")["playbackSessionsCollection"];
let resetAllPlaybackRuntime: typeof import("@/lib/stores/playback-runtime-store")["resetAllPlaybackRuntime"];
let setPlaybackChannelRuntime: typeof import("@/lib/stores/playback-runtime-store")["setPlaybackChannelRuntime"];
let useNodeSession: typeof import("./use-node-session")["useNodeSession"];

beforeAll(async () => {
  ({ buildNodeSessionFromTemplate } = await import(
    "@/lib/node-graph/templates"
  ));
  ({ playbackSessionsCollection } = await import(
    "@/lib/collections/playback-sessions"
  ));
  ({ resetAllPlaybackRuntime, setPlaybackChannelRuntime } = await import(
    "@/lib/stores/playback-runtime-store"
  ));
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
