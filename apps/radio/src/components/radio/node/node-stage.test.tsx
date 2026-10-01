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
let compile: typeof import("@/lib/node-graph/compile")["compile"];
let deriveNodeChannels: typeof import("@/lib/node-graph/session-channels")["deriveNodeChannels"];
let nodeGraphSchema: typeof import("@/lib/node-graph/schema")["nodeGraphSchema"];
let buildNodeSessionFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeSessionFromTemplate"];
let playbackSessionsCollection: typeof import("@/lib/collections/playback-sessions")["playbackSessionsCollection"];
let resetAllPlaybackRuntime: typeof import("@/lib/stores/playback-runtime-store")["resetAllPlaybackRuntime"];
let setPlaybackChannelRuntime: typeof import("@/lib/stores/playback-runtime-store")["setPlaybackChannelRuntime"];

beforeAll(async () => {
  ({ NodeStage } = await import("./node-stage"));
  ({ compile } = await import("@/lib/node-graph/compile"));
  ({ deriveNodeChannels } = await import("@/lib/node-graph/session-channels"));
  ({ nodeGraphSchema } = await import("@/lib/node-graph/schema"));
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

const REPICK_ROW = /Pick the file again/;

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

  test("lists an Audio input next to the Stations, with Go live and volume", async () => {
    const session = buildNodeSessionFromTemplate("start-from-multiple", {
      session: [kexp],
    });
    const graph = nodeGraphSchema.parse({
      ...session.graph,
      edges: [
        ...(session.graph?.edges ?? []),
        {
          id: "mic->speakers",
          source: "mic",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        ...(session.graph?.nodes ?? []),
        {
          data: { deviceId: "mic", deviceLabel: "Desk mic" },
          id: "mic",
          position: { x: 0, y: 200 },
          type: "deviceIn",
        },
      ],
    });
    playbackSessionsCollection.insert({
      ...session,
      channels: deriveNodeChannels(
        compile(graph, { crossOriginIsolated: false })
      ),
      graph,
    });
    const { controls, view } = renderStage();

    const sources = await waitFor(() =>
      view.getByRole("list", { name: "Sources" })
    );
    expect(within(sources).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      within(sources).getByRole("button", { name: "Go live Desk mic" })
    );
    expect(controls.setPlaying).toHaveBeenLastCalledWith("mic", true);
    fireEvent.keyDown(
      within(sources).getByRole("slider", { name: "Volume Desk mic" }),
      { key: "ArrowLeft" }
    );
    expect(controls.setVolume).toHaveBeenLastCalledWith("mic", 0.99);
    // Cabled to Speakers, the phone says what the canvas says.
    expect(
      within(sources).getByText("Use headphones: a mic into speakers can howl")
    ).toBeTruthy();
  });

  test("shared audio uses Go live without microphone feedback controls", async () => {
    const session = buildNodeSessionFromTemplate("starter");
    const graph = nodeGraphSchema.parse({
      ...session.graph,
      edges: [
        {
          id: "tab->speakers",
          source: "tab",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        {
          data: {
            capture: "display",
            deviceId: "display",
            deviceLabel: "Spotify",
            sourceUrl: "https://open.spotify.com/",
          },
          id: "tab",
          position: { x: 0, y: 0 },
          type: "deviceIn",
        },
        {
          data: {},
          id: "speakers",
          position: { x: 300, y: 0 },
          type: "speakers",
        },
      ],
    });
    playbackSessionsCollection.insert({
      ...session,
      channels: deriveNodeChannels(
        compile(graph, { crossOriginIsolated: false })
      ),
      graph,
    });
    const { controls, view } = renderStage();
    const sources = await waitFor(() =>
      view.getByRole("list", { name: "Sources" })
    );
    expect(within(sources).getByText("Shared tab audio")).toBeTruthy();
    fireEvent.click(
      within(sources).getByRole("button", { name: "Go live Spotify" })
    );
    expect(controls.setPlaying).toHaveBeenLastCalledWith("tab", true);
    expect(within(sources).queryByText("Echo cancellation")).toBeNull();
  });

  test("an empty patch points at the search", async () => {
    const { view } = renderStage();

    await waitFor(() =>
      expect(view.getByText("Search to add a station")).toBeTruthy()
    );
    expect(view.getByRole("button", { name: "Play all (0)" })).toBeTruthy();
  });

  test("a File to pick again after a reload shows, and opens its File", async () => {
    const { NodeActionsProvider } = await import("./node-actions");
    const { buildNodeSessionFromGraph } = await import(
      "@/lib/node-graph/templates"
    );
    const { forgetLocalFileUrls, localFileRadio } = await import(
      "@/lib/node-graph/sources"
    );
    const radio = localFileRadio("tone", {
      displayName: "tone",
      duration: 10,
      fileName: "tone.wav",
      fileSize: 100,
      mimeType: "audio/wav",
      objectUrl: "blob:https://radio.test/tone",
    });
    forgetLocalFileUrls();
    const position = { x: 0, y: 0 };
    playbackSessionsCollection.insert(
      buildNodeSessionFromGraph(
        nodeGraphSchema.parse({
          edges: [],
          nodes: [
            { data: { radio }, id: "tone", position, type: "file" },
            { data: {}, id: "speakers", position, type: "speakers" },
          ],
          version: 2,
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      )
    );
    const revealNode = mock((_nodeId: string) => undefined);
    const noop = () => undefined;
    const asyncNoop = async () => undefined;
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <NodeActionsProvider
          value={{
            fillSource: asyncNoop,
            fillStation: asyncNoop,
            fillStationFromUrl: async () => null,
            handleDeleteRadio: noop,
            handleEditRadio: noop,
            handleSaveSessionRadio: noop,
            handleToggleRadio: asyncNoop,
            inspectNode: noop,
            radios: [],
            removeNode: noop,
            revealNode,
            saveDiscoveredStation: noop,
            selectDiscoveredForStation: noop,
            swapEffect: noop,
          }}
        >
          <NodeStage />
        </NodeActionsProvider>
      </QueryClientProvider>
    );

    const row = await waitFor(() =>
      view.getByRole("button", { name: REPICK_ROW })
    );
    expect(view.queryByText("Search to add a station")).toBeNull();
    fireEvent.click(row);
    expect(revealNode.mock.calls).toEqual([["tone"]]);
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
