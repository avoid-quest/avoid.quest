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

let createDefaultChannel: typeof import("@/lib/collections/playback-sessions")["createDefaultChannel"];
let playbackSessionsCollection: typeof import("@/lib/collections/playback-sessions")["playbackSessionsCollection"];
let resetAllPlaybackRuntime: typeof import("@/lib/stores/playback-runtime-store")["resetAllPlaybackRuntime"];
let useMultipleSession: typeof import("./use-multiple-session")["useMultipleSession"];

beforeAll(async () => {
  ({ createDefaultChannel, playbackSessionsCollection } = await import(
    "@/lib/collections/playback-sessions"
  ));
  ({ resetAllPlaybackRuntime } = await import(
    "@/lib/stores/playback-runtime-store"
  ));
  ({ useMultipleSession } = await import("./use-multiple-session"));
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

describe("useMultipleSession", () => {
  test("reports a persisted muted Channel as muted at positive volume", async () => {
    const radio = {
      id: "muted",
      name: "Muted Station",
      streamUrl: "https://radio.example/muted.mp3",
    };
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("multi:muted", "multiple", 0),
          muted: true,
          radio,
          volume: 0.35,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "multiple",
      masterVolume: 1,
    });

    const { result } = renderHook(() => useMultipleSession());

    await waitFor(() => expect(result.current.players).toHaveLength(1));
    expect(result.current.players[0]).toMatchObject({
      isMuted: true,
      volume: 0.35,
    });
  });
});
