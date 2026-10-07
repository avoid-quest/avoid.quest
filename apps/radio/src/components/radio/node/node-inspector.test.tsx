/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
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
  AudioContext: dom.window.AudioContext,
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

// Radix Select measures and scrolls, which JSDOM does not do.
Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: () => undefined,
});

type InspectorModule = typeof import("./node-inspector");
let NodeInspector: InspectorModule["NodeInspector"];
let isInspectable: InspectorModule["isInspectable"];
let useNodeInspector: InspectorModule["useNodeInspector"];
let NodeRack: typeof import("./node-rack")["NodeRack"];
let StepsEditor: typeof import("./modulation-editors")["StepsEditor"];
let ModulationCableControls: typeof import("./modulation-cables")["ModulationCableControls"];
let modulationTargetAvailability: typeof import("@/lib/node-graph/modulation-runtime")["modulationTargetAvailability"];
let CurveEditor: typeof import("./modulation-editors")["CurveEditor"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let useIsMobile: typeof import("@avoid.quest/ui/hooks/use-mobile")["useIsMobile"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let nodeGraphSchema: typeof import("@/lib/node-graph/schema")["nodeGraphSchema"];
let createNodeEffectConfig: typeof import("@/lib/node-graph/catalogue")["createNodeEffectConfig"];
let templates: typeof import("@/lib/node-graph/templates");
let EFFECT_LAYOUTS: typeof import("@/components/audio/effect-params/effect-layouts")["EFFECT_LAYOUTS"];
let getEffectParamDefs: typeof import("@/lib/audio/dsp/effects/param-traversal")["getEffectParamDefs"];

beforeAll(async () => {
  ({ NodeInspector, isInspectable, useNodeInspector } = await import(
    "./node-inspector"
  ));
  ({ NodeRack } = await import("./node-rack"));
  ({ StepsEditor, CurveEditor } = await import("./modulation-editors"));
  ({ ModulationCableControls } = await import("./modulation-cables"));
  ({ modulationTargetAvailability } = await import(
    "@/lib/node-graph/modulation-runtime"
  ));
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
const REPICK_FILE = /Lost\.wav.*Pick the file again/;

describe("modulation cable availability", () => {
  test("the parameter selector prevents duplicate assignments and releases removed choices", async () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        {
          id: "cutoff",
          source: "macro",
          sourceHandle: "out:control:main",
          target: "filter",
          targetHandle: "in:control:parameter",
        },
        {
          id: "resonance",
          parameter: "Q",
          source: "macro",
          sourceHandle: "out:control:main",
          target: "filter",
          targetHandle: "in:control:parameter",
        },
      ],
      nodes: [
        { id: "macro", position, type: "macro" },
        { data: {}, id: "filter", position, type: "filter" },
        { id: "out", position, type: "speakers" },
      ],
      version: 2,
    });
    const store = nodeStoreModule.createNodeStore(graph);
    const view = render(
      <ModulationCableControls edgeId="resonance" store={store} />
    );
    const trigger = view.getByRole("combobox", {
      name: "Modulation target parameter",
    });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const cutoff = await view.findByRole("option", { name: "Cutoff" });
    expect(cutoff.getAttribute("aria-disabled")).toBe("true");
    expect(
      view
        .getByRole("option", { name: "Resonance" })
        .getAttribute("aria-disabled")
    ).not.toBe("true");
    fireEvent.click(cutoff);
    expect(store.state.graph).toEqual(graph);
    fireEvent.keyDown(cutoff, { key: "Escape" });
    act(() =>
      nodeStoreModule.commitNodeGraph(
        (current) => ({
          ...current,
          edges: current.edges.filter((edge) => edge.id !== "cutoff"),
        }),
        store,
        "snapshot"
      )
    );
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const freed = await view.findByRole("option", { name: "Cutoff" });
    expect(freed.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(freed);
    expect(store.state.graph?.edges[0]?.parameter).toBe("frequency");
    expect(
      (await import("@/lib/node-graph/validate")).validate(
        store.state.graph ?? graph
      )
    ).toEqual([]);
    act(() => nodeStoreModule.undoNodeGraph(store));
    expect(store.state.graph?.edges[0]?.parameter).toBe("Q");
  });

  test.each(["active", "muted", "zero depth", "disabled source"])(
    "%s cable shows a fallback warning only when active",
    (state) => {
      const graph = nodeGraphSchema.parse({
        edges: [
          {
            depth: state === "zero depth" ? 0 : 0.25,
            id: "control",
            muted: state === "muted",
            parameter: "pan",
            source: "macro",
            sourceHandle: "out:control:control",
            target: "pan",
            targetHandle: "in:control:parameter",
          },
        ],
        nodes: [
          {
            data: { enabled: state !== "disabled source" },
            id: "macro",
            position,
            type: "macro",
          },
          { data: {}, id: "pan", position, type: "pan" },
          { data: {}, id: "out", position, type: "speakers" },
        ],
        version: 2,
      });
      modulationTargetAvailability.setState(() => ({ control: false }));
      const view = render(
        <ModulationCableControls
          edgeId="control"
          store={nodeStoreModule.createNodeStore(graph)}
        />
      );
      expect(Boolean(view.queryByText("unavailable on Safari/fallback"))).toBe(
        state === "active"
      );
    }
  );
});

describe("modulation pattern editors", () => {
  test("the hold control follows added and removed envelope stages", async () => {
    const { ModulationControls } = await import("./control-node");
    const points = Array.from({ length: 10 }, (_, index) => ({
      bend: 0,
      time: index / 9,
      value: index / 9,
    }));
    const graph = nodeGraphSchema.parse({
      edges: [],
      nodes: [
        { data: { points }, id: "env", position, type: "multiEnvelope" },
        { data: {}, id: "speakers", position, type: "speakers" },
      ],
      version: 2,
    });
    const store = nodeStoreModule.createNodeStore(graph);
    const node = graph.nodes.find((entry) => entry.type === "multiEnvelope");
    if (node?.type !== "multiEnvelope") {
      throw new Error("Missing envelope");
    }
    const view = render(<ModulationControls node={node} store={store} />);
    const hold = view.getByRole("slider", {
      name: "Multi-stage envelope hold point",
    });
    expect(hold.getAttribute("aria-valuemax")).toBe("8");
    fireEvent.keyDown(hold, { key: "End" });
    const edited = store.state.graph?.nodes.find((entry) => entry.id === "env");
    expect(edited?.data).toMatchObject({ sustainPoint: 8 });
    if (edited?.type !== "multiEnvelope") {
      throw new Error("Missing edited envelope");
    }
    view.rerender(<ModulationControls node={edited} store={store} />);
    const curve = view.getByRole("img", {
      name: "Envelope curve; edit point values below",
    });
    Object.defineProperty(curve, "setPointerCapture", { value: noop });
    const heldPoint = curve.querySelector('[data-point="8"]');
    if (!heldPoint) {
      throw new Error("Missing held point");
    }
    fireEvent.pointerDown(heldPoint, { pointerId: 1 });
    fireEvent.click(view.getByRole("button", { name: "Remove point" }));
    const shortened = store.state.graph?.nodes.find(
      (entry) => entry.id === "env"
    );
    expect(shortened?.data).toMatchObject({ sustainPoint: 7 });
    if (shortened?.type !== "multiEnvelope") {
      throw new Error("Missing shortened envelope");
    }
    expect(shortened.data.points).toHaveLength(9);
    view.rerender(<ModulationControls node={shortened} store={store} />);
    expect(hold.getAttribute("aria-valuemax")).toBe("7");
  });

  test("a curve can add points past sixteen", () => {
    const points = Array.from({ length: 16 }, (_, index) => ({
      bend: 0,
      time: index / 15,
      value: index / 15,
    }));
    const onChange = mock((_points: typeof points) => undefined);
    const view = render(<CurveEditor onChange={onChange} points={points} />);
    fireEvent.click(view.getByRole("button", { name: "Add point" }));
    const added = onChange.mock.calls[0]?.[0];
    expect(added).toHaveLength(17);
    expect(
      nodeGraphSchema.safeParse({
        edges: [],
        nodes: [
          { data: { points: added }, id: "curve", position, type: "curve" },
          { data: {}, id: "speakers", position, type: "speakers" },
        ],
        version: 2,
      }).success
    ).toBe(true);
  });

  test("dragging between close curve neighbors preserves a valid editable point", () => {
    const points = [0, 0.5, 0.5005, 0.501, 1].map((time) => ({
      bend: 0,
      time,
      value: 0.5,
    }));
    const onChange = mock((_points: typeof points) => undefined);
    const view = render(<CurveEditor onChange={onChange} points={points} />);
    const curve = view.getByRole("img", {
      name: "Envelope curve; edit point values below",
    });
    Object.defineProperty(curve, "setPointerCapture", { value: noop });
    Object.defineProperty(curve, "getBoundingClientRect", {
      value: () => ({ height: 100, left: 0, top: 0, width: 288 }),
    });
    const selected = curve.querySelector('[data-point="2"]');
    if (!selected) {
      throw new Error("Missing curve point");
    }
    fireEvent.pointerDown(selected, { pointerId: 1 });
    fireEvent(
      curve,
      new dom.window.MouseEvent("pointermove", {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    );
    const edited = onChange.mock.calls[0]?.[0];
    expect(edited?.[2]?.time).toBeGreaterThan(0.5);
    expect(edited?.[2]?.time).toBeLessThan(0.501);
    expect(edited?.[2]?.value).toBe(1);
    expect(
      nodeGraphSchema.safeParse({
        edges: [],
        nodes: [
          { data: { points: edited }, id: "curve", position, type: "curve" },
          { data: {}, id: "speakers", position, type: "speakers" },
        ],
        version: 2,
      }).success
    ).toBe(true);
  });
  test("clearing or entering an invalid count preserves every authored step", () => {
    const onChange = mock((_values: number[]) => undefined);
    const values = [0.2, 0.8, 0.4, 0.9];
    const view = render(<StepsEditor onChange={onChange} values={values} />);
    const count = view.getByRole("spinbutton", { name: "Step count" });
    for (const value of ["", "not-a-number", "Infinity"]) {
      fireEvent.focusIn(count);
      fireEvent.change(count, { target: { value } });
      fireEvent.keyUp(count, { key: "Backspace" });
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(count, { target: { value: "6" } });
    fireEvent.keyUp(count, { key: "6" });
    expect(onChange).toHaveBeenCalledWith([...values, 0, 0]);
  });

  test("only points with an outgoing segment expose a Bend control", () => {
    const onChange = mock(() => undefined);
    const points = [
      { bend: 0.4, time: 0, value: 0 },
      { bend: 0, time: 1, value: 1 },
    ];
    const view = render(<CurveEditor onChange={onChange} points={points} />);
    expect(view.getByRole("slider", { name: "Point bend" })).toBeTruthy();
    const curve = view.getByRole("img", {
      name: "Envelope curve; edit point values below",
    });
    Object.defineProperty(curve, "setPointerCapture", { value: noop });
    const finalPoint = curve.querySelector('[data-point="1"]');
    if (!finalPoint) {
      throw new Error("Missing final curve point");
    }
    fireEvent.pointerDown(finalPoint, { pointerId: 1 });
    expect(view.queryByRole("slider", { name: "Point bend" })).toBeNull();
    expect(view.getByRole("slider", { name: "Point value" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

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
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  );
}

/**
 * Node mode's wiring in small: the Rack and the inspector share one
 * `useNodeInspector`, which picks its layout from the viewport.
 */
function Harness({
  store,
  onInspect,
}: {
  store: NodeStore;
  onInspect?: () => void;
}) {
  const isPhone = useIsMobile();
  const inspector = useNodeInspector({ isPhone, onInspect, store });
  const graph = nodeStoreModule.useNodeGraph(store);
  const inspectorShown = !isPhone && inspector.nodeId !== null;
  const actions = {
    fillSource: asyncNoop,
    fillStation: asyncNoop,
    fillStationFromUrl: async () => null,
    handleDeleteRadio: noop,
    handleEditRadio: noop,
    handleSaveSessionRadio: noop,
    handleToggleRadio: asyncNoop,
    inspectNode: inspector.inspect,
    radios: [],
    removeNode: noop,
    revealNode: noop,
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
          env={{ crossOriginIsolated: false }}
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

function renderHarness(store: NodeStore, onInspect?: () => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness onInspect={onInspect} store={store} />
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

describe("isInspectable", () => {
  test("sources and outputs expose settings; a Merge has none", () => {
    const radio = (id: string) => ({
      id,
      name: id,
      streamUrl: `https://radio.example/${id}.mp3`,
    });
    const graph = nodeGraphSchema.parse({
      edges: [],
      nodes: [
        {
          data: { radio: radio("station") },
          id: "station",
          position,
          type: "station",
        },
        {
          data: { radio: radio("track") },
          id: "track",
          position,
          type: "platform",
        },
        { data: { radio: radio("file") }, id: "file", position, type: "file" },
        {
          data: { radio: null },
          id: "empty-station",
          position,
          type: "station",
        },
        { id: "empty-track", position, type: "platform" },
        { id: "empty-file", position, type: "file" },
        { id: "input", position, type: "deviceIn" },
        { data: {}, id: "merge", position, type: "merge" },
        { data: {}, id: "speakers", position, type: "speakers" },
      ],
      version: 2,
    });
    expect(
      Object.fromEntries(
        graph.nodes.map((node) => [node.id, isInspectable(node)])
      )
    ).toEqual({
      "empty-file": true,
      "empty-station": true,
      "empty-track": true,
      file: true,
      input: true,
      merge: false,
      speakers: true,
      station: true,
      track: true,
    });
  });
});

describe("NodeInspector", () => {
  test("Inspect reveals the desktop panel before showing the node", () => {
    const store = createStore();
    const expand = mock(() => {
      expect(store.state.selection.nodes).toEqual([]);
    });
    const view = renderHarness(store, expand);
    fireEvent.click(view.getByRole("button", { name: "Compressor settings" }));
    expect(expand).toHaveBeenCalledTimes(1);
    expect(view.getByRole("region", { name: "Compressor" })).toBeTruthy();
  });

  test("a patch with no lanes still exposes empty sources, inputs, loose FX and outputs", () => {
    const store = nodeStoreModule.createNodeStore(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [
          { data: {}, id: "station", position, type: "station" },
          { id: "track", position, type: "platform" },
          { id: "file", position, type: "file" },
          { id: "input", position, type: "deviceIn" },
          { id: "output", position, type: "deviceOut" },
          {
            data: { effect: createNodeEffectConfig("compressor", "comp") },
            id: "comp",
            position,
            type: "compressor",
          },
          { id: "speakers", position, type: "speakers" },
        ],
        version: 2,
      })
    );
    const view = renderHarness(store);
    const checkSettings = (name: string, check: () => void) => {
      fireEvent.click(view.getByRole("button", { name: `${name} settings` }));
      check();
      fireEvent.click(view.getByRole("button", { name: "Close settings" }));
    };
    checkSettings("Empty Station", () =>
      expect(view.getByPlaceholderText("Search or paste a stream")).toBeTruthy()
    );
    checkSettings("Empty Track", () =>
      expect(view.getByRole("group", { name: "Search on" })).toBeTruthy()
    );
    checkSettings("Empty File", () =>
      expect(view.getByText("Browse files")).toBeTruthy()
    );
    checkSettings("Audio input", () => {
      expect(
        view.getByRole("button", { name: "Allow microphone" })
      ).toBeTruthy();
      expect(
        view.getByRole("combobox", { name: "Input channels" })
      ).toBeTruthy();
    });
    checkSettings("Output device", () =>
      expect(view.getByText("Pick the output to play on")).toBeTruthy()
    );
    checkSettings("Speakers", () =>
      expect(view.getByRole("slider", { name: "Volume all" })).toBeTruthy()
    );
    checkSettings("Compressor", () =>
      expect(view.getByRole("slider", { name: "Threshold" })).toBeTruthy()
    );
  });

  test("a restored local File can be picked again from the Rack", () => {
    const store = nodeStoreModule.createNodeStore(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [
          {
            data: {
              radio: {
                enabled: true,
                id: "lost-file",
                name: "Lost.wav",
                platformMetadata: {
                  filename: "Lost.wav",
                  platform: "local-file",
                },
                streamUrl: "blob:https://radio.test/old",
              },
            },
            id: "file",
            position,
            type: "file",
          },
          { id: "speakers", position, type: "speakers" },
        ],
        version: 2,
      })
    );
    const view = renderHarness(store);
    fireEvent.click(view.getByRole("button", { name: REPICK_FILE }));
    expect(view.getByRole("button", { name: "Browse files" })).toBeTruthy();
  });

  test("a restored local folder hides its dead tracklist until picked again", () => {
    const store = nodeStoreModule.createNodeStore(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [
          {
            data: {
              radio: {
                enabled: true,
                id: "lost-folder",
                name: "Lost.wav",
                platformMetadata: {
                  isLocal: true,
                  itemType: "playlist",
                  platform: "static-audio",
                  streamUrl: "blob:https://radio.test/one",
                  tracks: [
                    { streamUrl: "blob:https://radio.test/one", title: "One" },
                    { streamUrl: "blob:https://radio.test/two", title: "Two" },
                  ],
                  url: "",
                },
                streamUrl: "blob:https://radio.test/one",
              },
            },
            id: "file",
            position,
            type: "file",
          },
          { id: "speakers", position, type: "speakers" },
        ],
        version: 2,
      })
    );
    const view = renderHarness(store);
    fireEvent.click(view.getByRole("button", { name: REPICK_FILE }));
    expect(view.getByRole("button", { name: "Browse files" })).toBeTruthy();
    expect(view.queryByLabelText("Current track")).toBeNull();
    expect(view.queryByText("Two")).toBeNull();
  });

  test("a queued strip edit cannot follow the selection into another source", async () => {
    const store = createStore();
    nodeStoreModule.commitNodeGraph(
      (graph) =>
        nodeGraphSchema.parse({
          ...graph,
          nodes: [
            ...graph.nodes,
            {
              data: {
                radio: {
                  id: "second",
                  name: "Second",
                  streamUrl: "https://radio.example/second.mp3",
                },
              },
              id: "second",
              position,
              type: "station",
            },
          ],
        }),
      store
    );
    nodeStoreModule.setNodeSelection({ edges: [], nodes: ["kexp"] }, store);
    const view = renderHarness(store);
    act(() => {
      fireEvent.keyDown(view.getByRole("slider", { name: "Pan KEXP" }), {
        key: "ArrowRight",
      });
      fireEvent.keyDown(view.getByRole("slider", { name: "Trim KEXP" }), {
        key: "ArrowUp",
      });
      nodeStoreModule.setNodeSelection({ edges: [], nodes: ["second"] }, store);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    const station = store.state.graph?.nodes.find(
      (node) => node.id === "second"
    );
    expect(station?.type).toBe("station");
    if (station?.type === "station") {
      expect(station.data.strip.trimDb).toBe(0);
      expect(station.data.strip.pan).toBe(0);
    }
  });

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

    // A Station shows its channel strip; a multiple selection nothing.
    act(() => {
      nodeStoreModule.setNodeSelection({ edges: [], nodes: ["kexp"] }, store);
    });
    expect(view.queryByRole("region", { name: "Compressor" })).toBeNull();
    expect(view.getByRole("region", { name: "KEXP" })).toBeTruthy();
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

describe("NodeInspector: a Track's tracklist", () => {
  function albumStore(): NodeStore {
    const { AUDIO_IN_HANDLE, AUDIO_OUT_HANDLE, SPEAKERS_NODE_ID } = templates;
    return nodeStoreModule.createNodeStore(
      nodeGraphSchema.parse({
        edges: [
          {
            id: `album->${SPEAKERS_NODE_ID}`,
            source: "album",
            sourceHandle: AUDIO_OUT_HANDLE,
            target: SPEAKERS_NODE_ID,
            targetHandle: AUDIO_IN_HANDLE,
          },
        ],
        nodes: [
          {
            data: {
              radio: {
                id: "album",
                name: "An album",
                platformMetadata: {
                  itemType: "album",
                  platform: "bandcamp",
                  tracks: [
                    { name: "One", streamUrl: "https://media.example/1.mp3" },
                    { name: "Two", streamUrl: "https://media.example/2.mp3" },
                  ],
                  url: "https://artist.bandcamp.com/album/an-album",
                },
                streamUrl: "https://media.example/2.mp3",
              },
            },
            id: "album",
            position,
            type: "platform",
          },
          { data: {}, id: SPEAKERS_NODE_ID, position, type: "speakers" },
        ],
        version: 2,
        viewport: { x: 0, y: 0, zoom: 1 },
      })
    );
  }

  test("a Track's strip has speed with key lock, a seek bar, loop and cue; no stream details", () => {
    const store = albumStore();
    nodeStoreModule.setNodeSelection({ edges: [], nodes: ["album"] }, store);
    const view = renderHarness(store);
    const panel = view.getByRole("region", { name: "An album" });

    expect(within(panel).getByRole("slider", { name: "Speed An album" }));
    expect(within(panel).getByRole("button", { name: "Key lock An album" }));
    expect(within(panel).getByRole("button", { name: "Loop An album" }));
    expect(within(panel).getByRole("button", { name: "Set cue" }));
    expect(within(panel).queryByText("Format")).toBeNull();

    act(() => {
      fireEvent.click(
        within(panel).getByRole("button", { name: "Loop An album" })
      );
    });
    const album = store.state.graph?.nodes.find((node) => node.id === "album");
    expect(album?.type === "platform" && album.data.strip.loop).toBe(true);
  });

  test("a Station's strip shows its stream, not a transport", () => {
    const store = createStore();
    nodeStoreModule.setNodeSelection({ edges: [], nodes: ["kexp"] }, store);
    const view = renderHarness(store);
    const panel = view.getByRole("region", { name: "KEXP" });

    expect(within(panel).getByRole("slider", { name: "Trim KEXP" }));
    expect(within(panel).getByRole("slider", { name: "Pan KEXP" }));
    expect(within(panel).getByRole("button", { name: "Solo KEXP" }));
    expect(within(panel).getByText("Progressive")).toBeTruthy();
    expect(within(panel).queryByRole("slider", { name: "Speed KEXP" })).toBe(
      null
    );
    expect(within(panel).queryByText("Set cue")).toBeNull();
  });

  test("the Rack opens an album's tracks in the inspector, the current one marked", () => {
    const view = renderHarness(albumStore());

    fireEvent.click(view.getByRole("button", { name: "Tracks of An album" }));

    const panel = view.getByRole("region", { name: "An album" });
    const rows = within(panel)
      .getAllByRole("button")
      .map((row) => row.textContent);
    expect(rows).toContain("1One");
    expect(within(panel).getByLabelText("Current track")).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: "Next track" })
    ).toHaveProperty("disabled", true);
  });
});
