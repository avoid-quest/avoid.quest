import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  spyOn,
  test,
} from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ResizeObserverStub {
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
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  ResizeObserver: ResizeObserverStub,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
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

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);
const { ReactFlow } = await import("@xyflow/react");
const { playbackSessionsCollection } = await import(
  "@/lib/collections/playback-sessions"
);
const { buildNodeSessionFromTemplate } = await import(
  "@/lib/node-graph/templates"
);
const { loadNodeGraph } = await import("@/lib/node-graph/node-store");
const { getNodePlayback } = await import("@/lib/node-playback");
const { resetAllPlaybackRuntime, setPlaybackChannelRuntime } = await import(
  "@/lib/stores/playback-runtime-store"
);
const { NodeRadios } = await import("./index");
const playback = getNodePlayback();

beforeAll(async () => {
  await playbackSessionsCollection.stateWhenReady();
});

beforeEach(() => {
  loadNodeGraph(null);
  resetAllPlaybackRuntime();
  const session = buildNodeSessionFromTemplate("start-from-multiple", {
    session: [
      {
        id: "station",
        name: "Station",
        streamUrl: "https://radio.test/station.mp3",
      },
    ],
  });
  if (playbackSessionsCollection.state.has("node")) {
    playbackSessionsCollection.delete("node");
  }
  playbackSessionsCollection.insert(session);
});

afterEach(() => {
  cleanup();
  spyOn(playback, "playAll").mockRestore();
  spyOn(playback, "pauseAll").mockRestore();
  playbackSessionsCollection.delete("node");
  resetAllPlaybackRuntime();
});

async function renderShortcut() {
  const playAll = spyOn(playback, "playAll").mockResolvedValue(undefined);
  const pauseAll = spyOn(playback, "pauseAll").mockImplementation(
    () => undefined
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeRadios />
      <ReactFlow
        defaultNodes={[
          { data: { label: "Module" }, id: "module", position: { x: 0, y: 0 } },
        ]}
        panActivationKeyCode={null}
      />
    </QueryClientProvider>
  );
  await waitFor(() => {
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    expect(playAll).toHaveBeenCalledTimes(1);
  });
  playAll.mockClear();
  return { ...view, pauseAll, playAll };
}

test("Space selects a focused React Flow module without toggling audio", async () => {
  const view = await renderShortcut();
  const module = view.getByTestId("rf__node-module");
  module.focus();
  fireEvent.keyDown(module, { code: "Space", key: " " });

  await waitFor(() => expect(module.classList.contains("selected")).toBe(true));
  expect(view.playAll).not.toHaveBeenCalled();
  expect(view.pauseAll).not.toHaveBeenCalled();
});

test("Space on the canvas background plays and pauses all sources", async () => {
  const view = await renderShortcut();
  const background = view.container.querySelector(".react-flow__pane");
  expect(background).toBeTruthy();
  fireEvent.keyDown(background as Element, { code: "Space", key: " " });
  expect(view.playAll).toHaveBeenCalledTimes(1);

  await act(() => {
    setPlaybackChannelRuntime("n:src-station", () => ({ isPlaying: true }));
  });
  await waitFor(() => {
    fireEvent.keyDown(background as Element, { code: "Space", key: " " });
    expect(view.pauseAll).toHaveBeenCalledTimes(1);
  });
});

test("Space in a search input or SVG cable target leaves playback alone", async () => {
  const view = await renderShortcut();
  fireEvent.keyDown(view.getByRole("combobox", { name: "Search stations" }), {
    code: "Space",
    key: " ",
  });
  const cable = document.createElementNS("http://www.w3.org/2000/svg", "g");
  cable.classList.add("react-flow__edge");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  cable.appendChild(path);
  view.container.appendChild(cable);
  fireEvent.keyDown(path, { code: "Space", key: " " });

  expect(view.playAll).not.toHaveBeenCalled();
  expect(view.pauseAll).not.toHaveBeenCalled();
});
