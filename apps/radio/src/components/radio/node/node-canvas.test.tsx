/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
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
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  SVGElement: dom.window.SVGElement,
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
const { act, cleanup, render } = await import("@testing-library/react");

afterEach(cleanup);

let NodeCanvas: typeof import("./node-canvas")["default"];
let NodeCanvasHint: typeof import("./canvas-hint")["NodeCanvasHint"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let templates: typeof import("@/lib/node-graph/templates");

beforeAll(async () => {
  ({ default: NodeCanvas } = await import("./node-canvas"));
  ({ NodeCanvasHint } = await import("./canvas-hint"));
  ({ NodeActionsProvider } = await import("./node-actions"));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  templates = await import("@/lib/node-graph/templates");
});

const noop = () => undefined;
const EMPTY_HINT = "Search a station in the slot, or press / to add a node";
const CABLE_HINT = "Drag a cable to empty space to add a node";

const kexp = {
  enabled: true,
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://radio.example/kexp.mp3",
};

/** The canvas and its hint, as the mode mounts them. */
function Patch() {
  const graph = nodeStoreModule.useNodeGraph();
  return (
    <div style={{ height: 600, position: "relative", width: 800 }}>
      <NodeCanvas
        fitRequest={0}
        onOpenConnect={noop}
        onOpenPalette={noop}
        reveal={null}
      />
      <NodeCanvasHint graph={graph} />
    </div>
  );
}

function mountStarter() {
  nodeStoreModule.loadNodeGraph(
    templates.buildNodeGraphFromTemplate("starter")
  );
  const actions = {
    fillStation: noop,
    handleDeleteRadio: noop,
    handleEditRadio: noop,
    handleSaveSessionRadio: noop,
    handleToggleRadio: noop,
    inspectNode: noop,
    radios: [],
    removeNode: noop,
    saveDiscoveredStation: noop,
    selectDiscoveredForStation: noop,
    swapEffect: noop,
  } as unknown as Parameters<typeof NodeActionsProvider>[0]["value"];
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NodeActionsProvider value={actions}>
        <Patch />
      </NodeActionsProvider>
    </QueryClientProvider>
  );
}

describe("NodeCanvas", () => {
  test("draws no React Flow attribution", () => {
    const view = mountStarter();

    expect(view.container.querySelector(".react-flow")).not.toBeNull();
    expect(view.container.querySelector(".react-flow__attribution")).toBeNull();
  });

  test("says what to do first until the slot holds a station", () => {
    const view = mountStarter();

    expect(view.getByText(EMPTY_HINT)).toBeTruthy();
    expect(view.queryByText(CABLE_HINT)).toBeNull();

    act(() => {
      nodeStoreModule.commitNodeGraph((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.type === "station"
            ? { ...node, data: { ...node.data, radio: kexp } }
            : node
        ),
      }));
    });

    expect(view.queryByText(EMPTY_HINT)).toBeNull();
    expect(view.getByText(CABLE_HINT)).toBeTruthy();
  });
});
