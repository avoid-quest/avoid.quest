import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ObserverStub {
  disconnect() {
    // JSDOM does not perform layout.
  }

  observe() {
    // JSDOM does not perform layout.
  }

  unobserve() {
    // JSDOM does not perform layout.
  }
}

for (const [key, value] of Object.entries({
  CustomEvent: dom.window.CustomEvent,
  document: dom.window.document,
  Element: dom.window.Element,
  fetch: () => Promise.reject(new Error("offline")),
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  IntersectionObserver: ObserverStub,
  localStorage: dom.window.localStorage,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  sessionStorage: dom.window.sessionStorage,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

// React DOM checks for input events when it loads, so it loads after the DOM.
const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

let NodeStage: typeof import("./node-stage")["NodeStage"];
let buildNodeSessionFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeSessionFromTemplate"];
let playbackSessionsCollection: typeof import("@/lib/collections/playback-sessions")["playbackSessionsCollection"];
let resetAllPlaybackRuntime: typeof import("@/lib/stores/playback-runtime-store")["resetAllPlaybackRuntime"];
let setPlaybackChannelRuntime: typeof import("@/lib/stores/playback-runtime-store")["setPlaybackChannelRuntime"];

beforeAll(async () => {
  ({ NodeStage } = await import("./node-stage"));
  ({ buildNodeSessionFromTemplate } = await import(
    "@/lib/node-graph/templates"
  ));
  ({ playbackSessionsCollection } = await import(
    "@/lib/collections/playback-sessions"
  ));
  ({ resetAllPlaybackRuntime, setPlaybackChannelRuntime } = await import(
    "@/lib/stores/playback-runtime-store"
  ));
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

const kexp = {
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://radio.example/kexp.mp3",
};
const nts = {
  id: "nts",
  name: "NTS 1",
  streamUrl: "https://radio.example/nts.mp3",
};

function renderStage() {
  const controls = {
    setPlaying: mock(async (_nodeId: string, _playing: boolean) => undefined),
    setVolume: mock((_nodeId: string, _volume: number) => undefined),
    toggleMute: mock((_nodeId: string) => undefined),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeStage controls={controls} />
    </QueryClientProvider>
  );
  return { controls, view };
}

describe("NodeStage", () => {
  test("shows the master and every source with play and volume", async () => {
    playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("start-from-multiple", {
        session: [kexp, nts],
      })
    );
    const { controls, view } = renderStage();

    await waitFor(() =>
      expect(view.getByRole("button", { name: "Play all (2)" })).toBeTruthy()
    );
    expect(view.getByRole("slider", { name: "Volume all" })).toBeTruthy();

    const sources = view.getByRole("list", { name: "Sources" });
    expect(within(sources).getAllByRole("listitem")).toHaveLength(2);
    for (const radio of [kexp, nts]) {
      const nodeId = `src-${radio.id}`;
      fireEvent.click(
        within(sources).getByRole("button", { name: `Play ${radio.name}` })
      );
      expect(controls.setPlaying).toHaveBeenLastCalledWith(nodeId, true);

      const volume = within(sources).getByRole("slider", {
        name: `Volume ${radio.name}`,
      });
      fireEvent.keyDown(volume, { key: "ArrowLeft" });
      expect(controls.setVolume).toHaveBeenLastCalledWith(nodeId, 0.99);
    }
  });

  test("counts playing sources on the master", async () => {
    playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("start-from-multiple", {
        session: [kexp, nts],
      })
    );
    setPlaybackChannelRuntime("n:src-nts", () => ({ isPlaying: true }));
    const { controls, view } = renderStage();

    await waitFor(() =>
      expect(view.getByRole("button", { name: "Pause all (1)" })).toBeTruthy()
    );
    fireEvent.click(view.getByRole("button", { name: "Pause NTS 1" }));
    expect(controls.setPlaying).toHaveBeenLastCalledWith("src-nts", false);
  });

  test("an empty patch points at the search", async () => {
    const { view } = renderStage();

    await waitFor(() =>
      expect(view.getByText("Search to add a station")).toBeTruthy()
    );
    expect(view.getByRole("button", { name: "Play all (0)" })).toBeTruthy();
  });

  test("the Starter patch's empty slot still points at the search", async () => {
    playbackSessionsCollection.insert(buildNodeSessionFromTemplate("starter"));
    const { view } = renderStage();

    await waitFor(() =>
      expect(view.getByText("Search to add a station")).toBeTruthy()
    );
    expect(view.queryByRole("list", { name: "Sources" })).toBeNull();
  });
});
