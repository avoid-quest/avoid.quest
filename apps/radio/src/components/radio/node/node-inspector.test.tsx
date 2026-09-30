/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { NodeStore } from "@/lib/node-graph/node-store";

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

/** A viewport `width` px wide, as useIsMobile reads it. */
function setViewportWidth(width: number) {
  Object.defineProperty(dom.window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

Object.defineProperty(dom.window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    matches: false,
    media: query,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});

// JSDOM has no canvas; the Compressor's curve draws nothing.
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});

for (const [key, value] of Object.entries({
  CustomEvent: dom.window.CustomEvent,
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  fetch: () => Promise.reject(new Error("offline")),
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
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

type InspectorModule = typeof import("./node-inspector");
let NodeInspector: InspectorModule["NodeInspector"];
let useNodeInspector: InspectorModule["useNodeInspector"];
let NodeRack: typeof import("./node-rack")["NodeRack"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let useIsMobile: typeof import("@avoid.quest/ui/hooks/use-mobile")["useIsMobile"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let nodeGraphSchema: typeof import("@/lib/node-graph/schema")["nodeGraphSchema"];
let createNodeEffectConfig: typeof import("@/lib/node-graph/catalogue")["createNodeEffectConfig"];
let templates: typeof import("@/lib/node-graph/templates");
let EFFECT_LAYOUTS: typeof import("@/components/audio/effect-params/effect-layouts")["EFFECT_LAYOUTS"];
let getEffectParamDefs: typeof import("@/lib/audio/dsp/effects/param-traversal")["getEffectParamDefs"];

beforeAll(async () => {
  ({ NodeInspector, useNodeInspector } = await import("./node-inspector"));
  ({ NodeRack } = await import("./node-rack"));
  ({ NodeActionsProvider } = await import("./node-actions"));
  ({ useIsMobile } = await import("@avoid.quest/ui/hooks/use-mobile"));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  ({ nodeGraphSchema } = await import("@/lib/node-graph/schema"));
  ({ createNodeEffectConfig } = await import("@/lib/node-graph/catalogue"));
  templates = await import("@/lib/node-graph/templates");
  ({ EFFECT_LAYOUTS } = await import(
    "@/components/audio/effect-params/effect-layouts"
  ));
  ({ getEffectParamDefs } = await import(
    "@/lib/audio/dsp/effects/param-traversal"
  ));
});

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

const noop = () => undefined;
const asyncNoop = async () => undefined;
const position = { x: 0, y: 0 };

/** KEXP through a Compressor and a Filter to Speakers. */
function createStore(): NodeStore {
  const { AUDIO_IN_HANDLE, AUDIO_OUT_HANDLE, SPEAKERS_NODE_ID } = templates;
  const cable = (source: string, target: string) => ({
    id: `${source}->${target}`,
    source,
    sourceHandle: AUDIO_OUT_HANDLE,
    target,
    targetHandle: AUDIO_IN_HANDLE,
  });
  return nodeStoreModule.createNodeStore(
    nodeGraphSchema.parse({
      edges: [
        cable("kexp", "lp"),
        cable("lp", "comp"),
        cable("comp", SPEAKERS_NODE_ID),
      ],
      nodes: [
        {
          data: {
            radio: {
              id: "kexp",
              name: "KEXP",
              streamUrl: "https://radio.example/kexp.mp3",
            },
          },
          id: "kexp",
          position,
          type: "station",
        },
        { data: {}, id: "lp", position, type: "filter" },
        {
          data: { effect: createNodeEffectConfig("compressor", "comp") },
          id: "comp",
          position,
          type: "compressor",
        },
        { data: {}, id: SPEAKERS_NODE_ID, position, type: "speakers" },
      ],
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  );
}

/**
 * Node mode's wiring in small: the Rack and the inspector share one
 * `useNodeInspector`, which picks its layout from the viewport.
 */
function Harness({ store }: { store: NodeStore }) {
  const isPhone = useIsMobile();
  const inspector = useNodeInspector({ isPhone, store });
  const graph = nodeStoreModule.useNodeGraph(store);
  const inspectorShown = !isPhone && inspector.nodeId !== null;
  const actions = {
    fillStation: asyncNoop,
    handleDeleteRadio: noop,
    handleEditRadio: noop,
    handleSaveSessionRadio: noop,
    handleToggleRadio: asyncNoop,
    inspectNode: inspector.inspect,
    radios: [],
    removeNode: noop,
    saveDiscoveredStation: noop,
    selectDiscoveredForStation: noop,
    swapEffect: noop,
  };
  const controls = {
    setPlaying: asyncNoop,
    setVolume: noop,
    toggleMute: noop,
  };
  return (
    <NodeActionsProvider value={actions}>
      {/* As in Node mode, the desktop inspector takes the Rack's place. */}
      {inspectorShown ? (
        <NodeInspector
          nodeId={inspector.nodeId}
          onClose={inspector.close}
          store={store}
        />
      ) : null}
      {graph && !inspectorShown ? (
        <NodeRack
          controls={controls}
          env={{ crossOriginIsolated: false, profile: "desktop" }}
          graph={graph}
        />
      ) : null}
      {isPhone ? (
        <NodeInspector
          isPhone
          nodeId={inspector.nodeId}
          onClose={inspector.close}
          open={inspector.open}
          store={store}
        />
      ) : null}
    </NodeActionsProvider>
  );
}

function renderHarness(store: NodeStore) {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness store={store} />
    </QueryClientProvider>
  );
}

/** The MIDI learn targets inside `root`. */
function midiTargets(root: HTMLElement): string[] {
  return [...root.querySelectorAll("[data-midi-target]")].map(
    (element) => element.getAttribute("data-midi-target") ?? ""
  );
}

/** The Compressor's knobs past the first row, outside collapsed rows. */
function compressorKnobsPastFirstRow(): string[] {
  const sliders = new Set(
    getEffectParamDefs("compressor")
      .filter((param) => param.type === "slider")
      .map((param) => param.key)
  );
  const rows = EFFECT_LAYOUTS.compressor?.rows ?? [];
  return rows
    .slice(1)
    .flatMap((row) => (row.collapsible ? [] : row.keys))
    .filter((key) => sliders.has(key));
}

describe("NodeInspector", () => {
  test("selecting an FX node shows its full params", () => {
    const store = createStore();
    const view = renderHarness(store);
    expect(view.queryByRole("region", { name: "Compressor" })).toBeNull();

    act(() => {
      nodeStoreModule.setNodeSelection({ edges: [], nodes: ["comp"] }, store);
    });

    const panel = view.getByRole("region", { name: "Compressor" });
    const targets = midiTargets(panel);
    // Beyond the node body's first row, as MIDI-learnable node targets.
    const pastFirstRow = compressorKnobsPastFirstRow();
    expect(pastFirstRow.length).toBeGreaterThan(0);
    for (const key of ["threshold", ...pastFirstRow]) {
      expect(targets).toContain(`node:comp:${key}`);
    }
    expect(targets).toContain("node:comp:dryWet");
    expect(within(panel).getByRole("switch", { name: "Compressor on" }));

    // A Station has nothing to inspect; nor does a multiple selection.
    act(() => {
      nodeStoreModule.setNodeSelection({ edges: [], nodes: ["kexp"] }, store);
    });
    expect(view.queryByRole("region", { name: "Compressor" })).toBeNull();
    act(() => {
      nodeStoreModule.setNodeSelection(
        { edges: [], nodes: ["comp", "lp"] },
        store
      );
    });
    expect(view.queryByRole("region", { name: "Compressor" })).toBeNull();
  });

  test("a knob turn is throttled into the patch and its release is one undo step", async () => {
    const store = createStore();
    nodeStoreModule.setNodeSelection({ edges: [], nodes: ["comp"] }, store);
    const view = renderHarness(store);
    const before = store.state.graph;

    const knob = within(view.getByRole("region", { name: "Compressor" }))
      .getAllByRole("slider")
      .find((slider) => slider.getAttribute("aria-label") === "Threshold");
    expect(knob).toBeTruthy();
    act(() => {
      fireEvent.keyDown(knob as HTMLElement, { key: "ArrowUp" });
    });
    const threshold = (graph: typeof before) => {
      const comp = graph?.nodes.find((node) => node.id === "comp");
      return (comp?.data as { effect: { threshold: number } } | undefined)
        ?.effect.threshold;
    };
    expect(threshold(store.state.graph) ?? 0).toBeGreaterThan(
      threshold(before) ?? 0
    );
    // Mid-turn, nothing is an undo step yet.
    expect(store.state.history.present).toBe(before);

    act(() => {
      fireEvent.keyUp(knob as HTMLElement, { key: "ArrowUp" });
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(store.state.history.present).toBe(store.state.graph);
    expect(store.state.history.past.at(-1)).toBe(before ?? undefined);
  });

  test("closing clears the selection, back to the Rack", () => {
    const store = createStore();
    nodeStoreModule.setNodeSelection({ edges: [], nodes: ["comp"] }, store);
    const view = renderHarness(store);

    fireEvent.click(view.getByRole("button", { name: "Close settings" }));

    expect(store.state.selection.nodes).toEqual([]);
    expect(view.queryByRole("region", { name: "Compressor" })).toBeNull();
  });

  test("a Rack FX chip opens the inspector for that effect", () => {
    const store = createStore();
    const view = renderHarness(store);

    fireEvent.click(view.getByRole("button", { name: "Compressor settings" }));

    expect(store.state.selection.nodes).toEqual(["comp"]);
    const panel = view.getByRole("region", { name: "Compressor" });
    expect(midiTargets(panel)).toContain("node:comp:threshold");

    // A native strip chip opens its knobs.
    fireEvent.click(
      within(panel).getByRole("button", { name: "Close settings" })
    );
    fireEvent.click(view.getByRole("button", { name: "Filter settings" }));
    const filter = view.getByRole("region", { name: "Filter" });
    expect(midiTargets(filter)).toEqual(["node:lp:frequency", "node:lp:Q"]);
  });

  test("a chip moves focus into the inspector, and closing hands it back", () => {
    const store = createStore();
    const view = renderHarness(store);
    const chip = view.getByRole("button", { name: "Compressor settings" });
    chip.focus();

    fireEvent.click(chip);

    // The chip left with the Rack; the panel holds focus, not the page.
    const panel = view.getByRole("region", { name: "Compressor" });
    expect(document.activeElement).toBe(panel);

    const close = within(panel).getByRole("button", { name: "Close settings" });
    close.focus();
    fireEvent.click(close);

    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Compressor settings" })
    );
  });

  test("a canvas selection leaves focus where it is", () => {
    const store = createStore();
    const view = renderHarness(store);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    act(() => {
      nodeStoreModule.setNodeSelection({ edges: [], nodes: ["comp"] }, store);
    });

    expect(view.getByRole("region", { name: "Compressor" })).toBeTruthy();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test("a closing Drawer keeps its node while it slides away", () => {
    setViewportWidth(390);
    const store = createStore();
    let latest: ReturnType<InspectorModule["useNodeInspector"]> | undefined;
    function Probe() {
      latest = useNodeInspector({ isPhone: true, store });
      return null;
    }
    render(<Probe />);

    act(() => latest?.inspect("comp"));
    expect(latest).toMatchObject({ nodeId: "comp", open: true });

    act(() => latest?.close());
    expect(latest).toMatchObject({ nodeId: "comp", open: false });

    act(() => latest?.inspect("lp"));
    expect(latest).toMatchObject({ nodeId: "lp", open: true });
  });

  test("on a 390 px viewport it opens as a Drawer", () => {
    setViewportWidth(390);
    const store = createStore();
    const view = renderHarness(store);
    expect(view.queryByRole("dialog")).toBeNull();

    // Selecting on the canvas does not pop a Drawer over the patch.
    act(() => {
      nodeStoreModule.setNodeSelection({ edges: [], nodes: ["comp"] }, store);
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByRole("region", { name: "Compressor" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Compressor settings" }));

    const drawer = view.getByRole("dialog", { name: "Compressor settings" });
    expect(drawer.getAttribute("data-slot")).toBe("drawer-content");
    expect(midiTargets(drawer)).toContain("node:comp:threshold");
    expect(within(drawer).getByRole("switch", { name: "Compressor on" }));

    // Removing the node closes its Drawer.
    act(() => {
      nodeStoreModule.commitNodeGraph(
        (graph) => ({
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== "comp"),
        }),
        store
      );
    });
    expect(view.queryByRole("dialog")).toBeNull();
  });
});
