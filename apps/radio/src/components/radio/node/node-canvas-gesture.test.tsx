/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import {
  loadNodeGraph,
  nodeStore,
  undoNodeGraph,
} from "@/lib/node-graph/node-store";
import { nodeGraphSchema } from "@/lib/node-graph/schema";
import { AUDIO_IN_HANDLE, AUDIO_OUT_HANDLE } from "@/lib/node-graph/templates";
import type { NodeActions } from "./node-actions";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          contentRect: target.getBoundingClientRect(),
          target,
        } as ResizeObserverEntry,
      ],
      this
    );
  }

  disconnect() {
    // Fixed dimensions replace JSDOM's missing layout.
  }

  unobserve() {
    // Fixed dimensions replace JSDOM's missing layout.
  }
}

class MatrixStub {
  readonly m22 = 1;
}

Object.defineProperty(dom.window, "DOMMatrixReadOnly", { value: MatrixStub });
Object.defineProperty(dom.window.navigator, "maxTouchPoints", { value: 2 });
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
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ResizeObserverStub,
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

for (const [key, value] of Object.entries({
  offsetHeight: 160,
  offsetWidth: 240,
})) {
  Object.defineProperty(dom.window.HTMLElement.prototype, key, {
    configurable: true,
    get: () => value,
  });
}
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
  bottom: 600,
  height: 600,
  left: 0,
  right: 1000,
  toJSON: () => undefined,
  top: 0,
  width: 1000,
  x: 0,
  y: 0,
});

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
let NodeCanvas: typeof import("./node-canvas")["default"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
beforeAll(async () => {
  ({ default: NodeCanvas } = await import("./node-canvas"));
  ({ NodeActionsProvider } = await import("./node-actions"));
});
afterEach(() => {
  cleanup();
  loadNodeGraph(null);
});

const noop = () => undefined;
const asyncNoop = async () => undefined;
const actions: NodeActions = {
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
  revealNode: noop,
  saveDiscoveredStation: noop,
  selectDiscoveredForStation: noop,
  swapEffect: noop,
};

async function renderCanvas() {
  const graph = nodeGraphSchema.parse({
    edges: [
      {
        id: "station->speakers",
        source: "station",
        sourceHandle: AUDIO_OUT_HANDLE,
        target: "speakers",
        targetHandle: AUDIO_IN_HANDLE,
      },
    ],
    nodes: [
      {
        data: { radio: null },
        id: "station",
        position: { x: 0, y: 0 },
        type: "station",
      },
      {
        data: {},
        id: "speakers",
        position: { x: 600, y: 0 },
        type: "speakers",
      },
      {
        data: { effect: createNodeEffectConfig("delay", "delay") },
        id: "delay",
        position: { x: 300, y: 300 },
        type: "delay",
      },
    ],
    version: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  loadNodeGraph(graph);
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeActionsProvider value={actions}>
        <NodeCanvas
          fitRequest={0}
          onOpenConnect={noop}
          onOpenPalette={noop}
          reveal={null}
        />
      </NodeActionsProvider>
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(view.container.querySelector(".react-flow__edge")).toBeTruthy()
  );
  const edge = view.container.querySelector(".react-flow__edge") as HTMLElement;
  const node = view.getByTestId("rf__node-delay");
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [edge],
  });
  return { edge, graph, node };
}

function touch(node: HTMLElement, identifier: number, clientX: number) {
  return {
    clientX,
    clientY: 300,
    identifier,
    pageX: clientX,
    pageY: 300,
    target: node,
  };
}

function dragOverCable(node: HTMLElement) {
  const start = touch(node, 1, 300);
  fireEvent.touchStart(node, { changedTouches: [start], touches: [start] });
  const moved = touch(node, 1, 320);
  fireEvent.touchMove(node, { changedTouches: [moved], touches: [moved] });
  const aimed = touch(node, 1, 340);
  fireEvent.touchMove(node, { changedTouches: [aimed], touches: [aimed] });
  return aimed;
}

function release(node: HTMLElement, point: ReturnType<typeof touch>) {
  fireEvent.touchEnd(node, { changedTouches: [point], touches: [] });
}

describe("canvas drag insertion", () => {
  test("a second touch cancels the aimed insertion before React Flow's aborted drop", async () => {
    const { edge, node } = await renderCanvas();
    const first = dragOverCable(node);
    expect(edge.classList.contains("node-edge-insert")).toBe(true);
    const second = touch(node, 2, 450);
    fireEvent.touchStart(node, {
      changedTouches: [second],
      touches: [first, second],
    });
    fireEvent.touchMove(node, {
      changedTouches: [first, second],
      touches: [first, second],
    });
    expect(edge.classList.contains("node-edge-insert")).toBe(false);
    fireEvent.touchEnd(node, {
      changedTouches: [first],
      touches: [second],
    });
    release(node, second);
    expect(nodeStore.state.graph?.edges.map((entry) => entry.id)).toEqual([
      "station->speakers",
    ]);

    // A fresh single-touch drag can still insert; no canceled target survives.
    const next = dragOverCable(node);
    expect(edge.classList.contains("node-edge-insert")).toBe(true);
    release(node, next);
    expect(
      nodeStore.state.graph?.edges.map((entry) => [entry.source, entry.target])
    ).toEqual([
      ["station", "delay"],
      ["delay", "speakers"],
    ]);
  });

  test.each(["pointerCancel", "lostPointerCapture", "touchCancel"] as const)(
    "%s cancels the current target and cannot re-arm it during that gesture",
    async (event) => {
      const { edge, node } = await renderCanvas();
      const point = dragOverCable(node);
      expect(edge.classList.contains("node-edge-insert")).toBe(true);
      if (event === "lostPointerCapture") {
        fireEvent(
          node,
          new dom.window.MouseEvent("lostpointercapture", {
            bubbles: true,
            buttons: 1,
          })
        );
      } else {
        fireEvent[event](node, { changedTouches: [point], touches: [] });
      }
      expect(edge.classList.contains("node-edge-insert")).toBe(false);
      const later = touch(node, 1, 380);
      fireEvent.touchMove(node, { changedTouches: [later], touches: [later] });
      release(node, later);
      expect(nodeStore.state.graph?.edges.map((entry) => entry.id)).toEqual([
        "station->speakers",
      ]);
    }
  );

  test("a genuine drop inserts and moves the loose node in one undo step", async () => {
    const { graph, node } = await renderCanvas();
    const point = dragOverCable(node);
    // Browsers implicitly release touch capture after pointerup. This is a
    // completed gesture, so the following touchend must still insert.
    fireEvent(
      node,
      new dom.window.MouseEvent("lostpointercapture", {
        bubbles: true,
        buttons: 0,
      })
    );
    release(node, point);
    expect(nodeStore.state.graph?.edges).toHaveLength(2);
    expect(nodeStore.state.history.past).toHaveLength(1);
    act(() => expect(undoNodeGraph()).toBe(true));
    // The canvas's own fit persists its viewport outside undo.
    expect({ ...nodeStore.state.graph, viewport: graph.viewport }).toEqual(
      graph
    );
  });
});
