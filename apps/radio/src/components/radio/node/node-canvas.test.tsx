/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
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

/**
 * Reports every observed element at once, so React Flow measures its nodes
 * and their ports as it would in a browser. JSDOM lays nothing out, so the
 * sizes below are made up.
 */
class MeasuringObserver {
  private readonly callback: (entries: ResizeEntry[]) => void;

  constructor(callback: (entries: ResizeEntry[]) => void) {
    this.callback = callback;
  }

  disconnect() {
    // Nothing to stop.
  }

  observe(target: Element) {
    this.callback([{ contentRect: { height: 600, width: 800 }, target }]);
  }

  unobserve() {
    // Nothing to stop.
  }
}

type ResizeEntry = {
  contentRect: { width: number; height: number };
  target: Element;
};

for (const key of ["offsetWidth", "offsetHeight"]) {
  Object.defineProperty(dom.window.HTMLElement.prototype, key, {
    configurable: true,
    get: () => 100,
  });
}

/** React Flow reads the viewport zoom from its CSS transform. */
class MatrixStub {
  m22 = 1;
}

/** What the pointer is over; JSDOM has no hit testing. */
let elementUnderPointer: Element | null = null;
dom.window.document.elementFromPoint = () => elementUnderPointer;
dom.window.DOMMatrixReadOnly = MatrixStub;

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
  ResizeObserver: MeasuringObserver,
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
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
  elementUnderPointer = null;
});

let NodeCanvas: typeof import("./node-canvas")["default"];
let phoneFitViewport: typeof import("./node-canvas")["phoneFitViewport"];
let NUDGE_SETTLE_MS: typeof import("./node-canvas")["NUDGE_SETTLE_MS"];
let NodeCanvasHint: typeof import("./canvas-hint")["NodeCanvasHint"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let nodeActionsModule: typeof import("./node-actions");
let graphEdits: typeof import("@/lib/node-graph/graph-edits");
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let templates: typeof import("@/lib/node-graph/templates");
let validateModule: typeof import("@/lib/node-graph/validate");
let sonner: typeof import("sonner");
let catalogue: typeof import("@/lib/node-graph/catalogue");
let schema: typeof import("@/lib/node-graph/schema");

beforeAll(async () => {
  ({
    default: NodeCanvas,
    NUDGE_SETTLE_MS,
    phoneFitViewport,
  } = await import("./node-canvas"));
  ({ NodeCanvasHint } = await import("./canvas-hint"));
  nodeActionsModule = await import("./node-actions");
  ({ NodeActionsProvider } = nodeActionsModule);
  graphEdits = await import("@/lib/node-graph/graph-edits");
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  templates = await import("@/lib/node-graph/templates");
  validateModule = await import("@/lib/node-graph/validate");
  sonner = await import("sonner");
  catalogue = await import("@/lib/node-graph/catalogue");
  schema = await import("@/lib/node-graph/schema");
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

type CanvasProps = Partial<import("react").ComponentProps<typeof NodeCanvas>>;

/** The canvas and its hint, as the mode mounts them. */
function Patch(props: CanvasProps) {
  const graph = nodeStoreModule.useNodeGraph();
  return (
    <div style={{ height: 600, position: "relative", width: 800 }}>
      <NodeCanvas
        fitRequest={0}
        onOpenConnect={noop}
        onOpenPalette={noop}
        reveal={null}
        {...props}
      />
      <NodeCanvasHint graph={graph} />
    </div>
  );
}

function mountStarter() {
  return mountGraph(templates.buildNodeGraphFromTemplate("starter"));
}

function mountGraph(
  graph: import("@/lib/node-graph/schema").NodeGraph,
  props: CanvasProps = {}
) {
  nodeStoreModule.loadNodeGraph(graph);
  const actions = {
    fillSource: noop,
    fillStation: noop,
    fillStationFromUrl: async () => null,
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
        <Patch {...props} />
      </NodeActionsProvider>
    </QueryClientProvider>
  );
}

describe("NodeCanvas", () => {
  test("Gate cables use unity depth and parameter cables name the selected parameter", async () => {
    const view = mountGraph(
      schema.nodeGraphSchema.parse({
        edges: [
          {
            id: "gate",
            source: "clock",
            sourceHandle: "out:control:main",
            target: "envelope",
            targetHandle: "in:control:gate",
          },
          {
            id: "cutoff",
            source: "macro",
            sourceHandle: "out:control:main",
            target: "filter",
            targetHandle: "in:control:parameter",
          },
        ],
        nodes: [
          { data: {}, id: "clock", position: { x: 0, y: 0 }, type: "clock" },
          {
            data: {},
            id: "envelope",
            position: { x: 300, y: 0 },
            type: "envelope",
          },
          { data: {}, id: "macro", position: { x: 0, y: 300 }, type: "macro" },
          {
            data: {},
            id: "filter",
            position: { x: 300, y: 300 },
            type: "filter",
          },
          { id: "speakers", position: { x: 600, y: 0 }, type: "speakers" },
        ],
        version: 2,
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      view.getByRole("button", { name: "Edit Gate modulation" }).textContent
    ).toBe("Gate · 100%");
    expect(
      view.getByRole("button", { name: "Edit Cutoff modulation" }).textContent
    ).toBe("Cutoff · 25%");
  });

  test("draws no React Flow attribution", () => {
    const view = mountStarter();

    expect(view.container.querySelector(".react-flow")).not.toBeNull();
    expect(view.container.querySelector(".react-flow__attribution")).toBeNull();
  });

  test("tells a focused module's screen reader that the arrow keys move it", () => {
    const view = mountStarter();
    const node = view.container.querySelector(".react-flow__node");
    const description = view.container.querySelector(
      `[id="${node?.getAttribute("aria-describedby")}"]`
    );

    expect(description?.textContent).toContain("arrow keys");
  });

  test("a run of arrow-key nudges is one undo step", async () => {
    const view = mountStarter();
    const { state } = nodeStoreModule.nodeStore;
    const start = state.graph?.nodes.find((entry) => entry.id === "speakers");
    const pastBefore = state.history.past.length;
    const node = view.container.querySelector(
      '.react-flow__node[data-id="speakers"]'
    ) as HTMLElement;
    act(() => {
      node.focus();
      fireEvent.keyDown(node, { key: "Enter" });
    });
    for (let press = 0; press < 5; press += 1) {
      act(() => {
        fireEvent.keyDown(node, { key: "ArrowRight" });
      });
    }
    await act(
      () => new Promise((resolve) => setTimeout(resolve, NUDGE_SETTLE_MS + 50))
    );

    const { graph, history } = nodeStoreModule.nodeStore.state;
    const moved = graph?.nodes.find((entry) => entry.id === "speakers");
    expect(moved?.position.x).toBe((start?.position.x ?? 0) + 25);
    expect(history.past).toHaveLength(pastBefore + 1);
    act(() => {
      expect(nodeStoreModule.undoNodeGraph()).toBe(true);
    });
    expect(
      nodeStoreModule.nodeStore.state.graph?.nodes.find(
        (entry) => entry.id === "speakers"
      )?.position
    ).toEqual(start?.position);
  });

  test("a knob turned right after a nudge is an undo step of its own", async () => {
    const view = mountGraph(
      schema.nodeGraphSchema.parse({
        edges: [],
        nodes: [
          {
            data: {
              effect: catalogue.createNodeEffectConfig("compressor", "comp"),
            },
            id: "comp",
            position: { x: 0, y: 0 },
            type: "compressor",
          },
          {
            data: {},
            id: "speakers",
            position: { x: 400, y: 0 },
            type: "speakers",
          },
        ],
        version: 2,
      })
    );
    const compressor = () => {
      const found = nodeStoreModule.nodeStore.state.graph?.nodes.find(
        (entry) => entry.id === "comp"
      );
      if (!found) {
        throw new Error("The Compressor is gone");
      }
      const { effect } = found.data as { effect: { threshold: number } };
      return { position: found.position, threshold: effect.threshold };
    };
    const start = compressor();
    const turnKnob = (threshold: number) =>
      nodeStoreModule.commitNodeGraph((graph) =>
        graphEdits.setEffectParams(graph, "comp", { threshold })
      );
    const node = view.container.querySelector(
      '.react-flow__node[data-id="comp"]'
    ) as HTMLElement;
    act(() => {
      node.focus();
      fireEvent.keyDown(node, { key: "Enter" });
    });
    act(() => {
      fireEvent.keyDown(node, { key: "ArrowRight" });
    });
    const nudged = compressor().position;
    // The knob drag starts before the nudge settles and outlasts it.
    act(() => {
      turnKnob(-30);
    });
    await act(
      () => new Promise((resolve) => setTimeout(resolve, NUDGE_SETTLE_MS + 50))
    );
    act(() => {
      turnKnob(-40);
      nodeStoreModule.snapshotNodeGraph();
    });

    expect(nudged).not.toEqual(start.position);
    act(() => {
      expect(nodeStoreModule.undoNodeGraph()).toBe(true);
    });
    expect(compressor()).toEqual({
      position: nudged,
      threshold: start.threshold,
    });
    act(() => {
      expect(nodeStoreModule.undoNodeGraph()).toBe(true);
    });
    expect(compressor()).toEqual(start);
  });

  test("a knob tick on one FX re-renders that FX's node alone", async () => {
    const fxIds = ["fx0", "fx1", "fx2", "fx3"];
    mountGraph(
      schema.nodeGraphSchema.parse({
        edges: [],
        nodes: [
          ...fxIds.map((id, index) => ({
            data: {
              effect: catalogue.createNodeEffectConfig("compressor", id),
            },
            id,
            position: { x: index * 300, y: 0 },
            type: "compressor",
          })),
          {
            data: {},
            id: "speakers",
            position: { x: 1200, y: 0 },
            type: "speakers",
          },
        ],
        version: 2,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Every FX node body asks for the node actions once per render.
    const renders = spyOn(nodeActionsModule, "useNodeActions");
    try {
      act(() => {
        nodeStoreModule.commitNodeGraph((graph) =>
          graphEdits.setEffectParams(graph, "fx0", { threshold: -30 })
        );
      });

      expect(renders).toHaveBeenCalledTimes(1);
    } finally {
      renders.mockRestore();
    }
  });

  test("a split's input reads as its input, its outputs as its branches", async () => {
    const view = mountGraph(
      schema.nodeGraphSchema.parse({
        edges: [],
        nodes: [
          {
            data: {
              effect: catalogue.createNodeEffectConfig("stereoSplit", "lr"),
            },
            id: "lr",
            position: { x: 0, y: 0 },
            type: "stereoSplit",
          },
          {
            data: {},
            id: "speakers",
            position: { x: 400, y: 0 },
            type: "speakers",
          },
        ],
        version: 2,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    const port = (handle: string) =>
      view.container.querySelector(
        `.react-flow__handle[data-nodeid="lr"][data-handleid="${handle}"]`
      );

    expect(port("in:audio:main")?.getAttribute("title")).toBe("Input");
    expect(port("in:audio:main")?.getAttribute("aria-label")).toBe(
      "Stereo Split input"
    );
    expect(port("out:audio:left")?.getAttribute("title")).toBe("Left");
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

  test("a patch with no slot points at the search bar", () => {
    const view = render(
      <NodeCanvasHint graph={templates.buildNodeGraphFromTemplate("blank")} />
    );

    expect(
      view.getByText("Search to add a station, or press / to add a node")
    ).toBeTruthy();
  });

  test("a phone says to tap +, since / needs a keyboard", () => {
    const view = render(
      <NodeCanvasHint
        graph={templates.buildNodeGraphFromTemplate("starter")}
        isPhone
      />
    );

    expect(
      view.getByText("Search a station in the slot, or tap + to add a node")
    ).toBeTruthy();
  });
});

describe("NodeCanvas: the view", () => {
  /** The canvas's pan and zoom, from React Flow's viewport transform. */
  const viewportTransform = (container: HTMLElement) =>
    (container.querySelector(".react-flow__viewport") as HTMLElement | null)
      ?.style.transform;

  /** Lets React Flow measure, then runs the canvas's next frames. */
  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  };

  test("a fit request is fitted once, then handed back", async () => {
    let handled = 0;
    mountGraph(templates.buildNodeGraphFromTemplate("starter"), {
      fitRequest: 1,
      onFitHandled: () => {
        handled += 1;
      },
    });
    await settle();

    expect(handled).toBe(1);
  });

  test("a node picked for a cable let go in space moves its port level with the drop", async () => {
    // A port 40 px down a node, as a module's sits under its header.
    const rect = spyOn(
      dom.window.HTMLElement.prototype,
      "getBoundingClientRect"
    ).mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("react-flow__handle")
        ? new dom.window.DOMRect(0, 40, 8, 8)
        : new dom.window.DOMRect(0, 0, 160, 100);
    });
    let handled = 0;
    try {
      mountGraph(
        schema.nodeGraphSchema.parse({
          edges: [
            {
              id: "kexp->verb",
              source: "kexp",
              sourceHandle: "out:audio:main",
              target: "verb",
              targetHandle: "in:audio:main",
            },
          ],
          nodes: [
            {
              data: { radio: kexp },
              id: "kexp",
              position: { x: 0, y: 0 },
              type: "station",
            },
            {
              data: {
                effect: catalogue.createNodeEffectConfig("cheapReverb", "verb"),
              },
              id: "verb",
              position: { x: 300, y: 480 },
              type: "cheapReverb",
            },
            {
              data: {},
              id: "speakers",
              position: { x: 600, y: 0 },
              type: "speakers",
            },
          ],
          version: 2,
        }),
        {
          onPortDropHandled: () => {
            handled += 1;
          },
          portDrop: {
            from: { handle: "out:audio:main", node: "kexp", type: "source" },
            nodeId: "verb",
            y: 500,
          },
        }
      );
      await settle();
    } finally {
      rect.mockRestore();
    }

    expect(handled).toBe(1);
    const { graph, history } = nodeStoreModule.nodeStore.state;
    expect(graph?.nodes.find((node) => node.id === "verb")?.position).toEqual({
      x: 300,
      // React Flow sizes a port by offsetHeight, 100 px in this harness.
      y: 500 - (40 + 100 / 2),
    });
    // Still the one step that added the node, not one of its own.
    expect(history.past).toHaveLength(0);
    expect(history.present).toBe(graph);
  });

  test("a patch replaced in place, as by an import, brings its own view", async () => {
    const view = mountGraph({
      ...templates.buildNodeGraphFromTemplate("starter"),
      viewport: { x: 10, y: 20, zoom: 1 },
    });
    await settle();
    expect(viewportTransform(view.container)).toBe(
      "translate(10px,20px) scale(1)"
    );

    act(() => {
      nodeStoreModule.commitNodeGraph(
        (graph) => ({ ...graph, viewport: { x: 120, y: 40, zoom: 0.5 } }),
        nodeStoreModule.nodeStore,
        "snapshot"
      );
    });
    await settle();

    expect(viewportTransform(view.container)).toBe(
      "translate(120px,40px) scale(0.5)"
    );
  });

  test("a phone opens fitted when the saved view shows none of the patch", async () => {
    const frame = spyOn(
      dom.window.HTMLElement.prototype,
      "getBoundingClientRect"
    ).mockImplementation(() => new dom.window.DOMRect(0, 0, 390, 600));
    try {
      const view = mountGraph(
        {
          ...templates.buildNodeGraphFromTemplate("starter"),
          viewport: { x: -50_000, y: -50_000, zoom: 1 },
        },
        { isPhone: true }
      );
      await settle();

      expect(viewportTransform(view.container)).not.toContain("-50000px");
    } finally {
      frame.mockRestore();
    }
  });

  test("a phone keeps a saved view that shows the patch", async () => {
    const frame = spyOn(
      dom.window.HTMLElement.prototype,
      "getBoundingClientRect"
    ).mockImplementation(() => new dom.window.DOMRect(0, 0, 390, 600));
    try {
      const view = mountGraph(
        {
          ...templates.buildNodeGraphFromTemplate("starter"),
          viewport: { x: 10, y: 20, zoom: 1 },
        },
        { isPhone: true }
      );
      await settle();

      expect(viewportTransform(view.container)).toBe(
        "translate(10px,20px) scale(1)"
      );
    } finally {
      frame.mockRestore();
    }
  });
});

describe("phoneFitViewport", () => {
  test("a patch too tall for the readable zoom opens on its top", () => {
    const viewport = phoneFitViewport(
      { height: 1400, width: 520, x: 0, y: -40 },
      390,
      600
    );

    expect(viewport.zoom).toBe(0.6);
    // Its top edge sits 16 px below the canvas top, not above it.
    expect(viewport.y + -40 * viewport.zoom).toBeCloseTo(16);
    // 520 × 0.6 fits the phone's width, so it stays centred.
    expect(viewport.x + 260 * viewport.zoom).toBeCloseTo(195);
  });

  test("a patch that fits is centred as React Flow would", () => {
    const viewport = phoneFitViewport(
      { height: 200, width: 300, x: 0, y: 0 },
      390,
      600
    );

    expect(viewport.zoom).toBe(1);
    expect(viewport.x + 150).toBeCloseTo(195);
    expect(viewport.y + 100).toBeCloseTo(300);
  });
});

describe("NodeCanvas: dragging a cable", () => {
  const at = { x: 0, y: 0 };
  const station = (id: string) => ({
    data: {
      radio: {
        id,
        name: id.toUpperCase(),
        streamUrl: `https://radio.example/${id}.mp3`,
      },
    },
    id,
    position: at,
    type: "station" as const,
  });
  const effect = (id: string, type: "compressor" | "cheapReverb") => ({
    data: { effect: catalogue.createNodeEffectConfig(type, id) },
    id,
    position: at,
    type,
  });
  const cable = (
    source: string,
    target: string,
    targetHandle = "in:audio:main"
  ) => ({
    id: `${source}->${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle,
  });

  // KEXP is loose. FIP feeds a Compressor keyed by NTS, so both of its
  // inputs are full; a Reverb waits unwired.
  function patch() {
    return schema.nodeGraphSchema.parse({
      edges: [
        cable("fip", "comp"),
        cable("nts", "comp", "in:sidechain:key"),
        cable("comp", "speakers"),
        cable("nts", "speakers"),
      ],
      nodes: [
        station("kexp"),
        station("fip"),
        station("nts"),
        effect("comp", "compressor"),
        effect("verb", "cheapReverb"),
        { data: {}, id: "speakers", position: at, type: "speakers" },
      ],
      version: 2,
    });
  }

  async function mountPatch() {
    const view = mountGraph(patch());
    // Let React Flow measure the nodes and their ports.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const port = (node: string, handle: string) => {
      const element = view.container.querySelector(
        `.react-flow__handle[data-nodeid="${node}"][data-handleid="${handle}"]`
      );
      if (!element) {
        throw new Error(`No port ${node} ${handle}`);
      }
      return element as HTMLElement;
    };
    return { port, view };
  }

  const move = (x: number, over: Element | null = null) => {
    elementUnderPointer = over;
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: x,
          clientY: -5000,
        })
      );
    });
  };

  const release = (over: Element | null) => {
    elementUnderPointer = over;
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: -5000,
          clientY: -5000,
        })
      );
    });
  };

  test("the connection mode is strict", async () => {
    const { port } = await mountPatch();
    const out = port("kexp", "out:audio:main");
    fireEvent.mouseDown(out, { button: 0, clientX: 0, clientY: 0 });
    move(-5000);
    // Strict: an output never ends on another output.
    expect(
      port("fip", "out:audio:main").classList.contains("connectableend")
    ).toBe(false);
    release(null);
  });

  test("a Station's cable lights every port it may end on and locks the rest, saying why", async () => {
    const { port } = await mountPatch();
    const out = port("kexp", "out:audio:main");
    fireEvent.mouseDown(out, { button: 0, clientX: 0, clientY: 0 });
    move(-5000);

    const accept = (element: HTMLElement) =>
      element.classList.contains("node-port-accept");
    const locked = (element: HTMLElement) =>
      element.classList.contains("node-port-locked") &&
      !element.classList.contains("connectableend");

    expect(accept(port("speakers", "in:audio:main"))).toBe(true);
    expect(accept(port("verb", "in:audio:main"))).toBe(true);
    expect(port("verb", "in:audio:main").title).toBe("Input");

    for (const [node, handle] of [
      ["kexp", "out:audio:main"],
      ["fip", "out:audio:main"],
      ["nts", "out:audio:main"],
    ] as const) {
      expect(locked(port(node, handle))).toBe(true);
    }
    expect(port("fip", "out:audio:main").title).toBe(
      validateModule.SAME_SIDE_MESSAGE
    );
    expect(port("comp", "in:sidechain:key").title).toBe("Key input");
    expect(port("comp", "in:sidechain:key").getAttribute("data-kind")).toBe(
      "sidechain"
    );

    release(null);
    expect(
      port("verb", "in:audio:main").classList.contains("node-port-accept")
    ).toBe(false);
    expect(port("comp", "in:sidechain:key").title).toBe("Key input");
  });

  test("takes every verdict once when the drag starts, none per pointer move", async () => {
    const { port } = await mountPatch();
    const spy = spyOn(validateModule, "validateConnection");
    try {
      fireEvent.mouseDown(port("kexp", "out:audio:main"), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      move(-5000);
      // Audio inputs plus each source/FX parameter input, once at drag start.
      expect(spy).toHaveBeenCalledTimes(9);

      const speakersIn = port("speakers", "in:audio:main");
      for (const x of [-4990, -4980, -4970]) {
        move(x, speakersIn);
      }
      move(-4960, port("comp", "in:sidechain:key"));
      expect(spy).toHaveBeenCalledTimes(9);
    } finally {
      spy.mockRestore();
      release(null);
    }
  });

  test("dropping on an occupied key sums both cables and one undo removes only the new one", async () => {
    const { port } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    try {
      fireEvent.mouseDown(port("kexp", "out:audio:main"), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      const key = port("comp", "in:sidechain:key");
      move(-5000, key);
      release(key);
      const keys = () =>
        nodeStoreModule.nodeStore.state.graph?.edges.filter(
          (edge) => edge.targetHandle === "in:sidechain:key"
        );
      expect(keys()?.map((edge) => edge.source)).toEqual(["nts", "kexp"]);
      expect(toast).not.toHaveBeenCalled();
      act(() => {
        nodeStoreModule.undoNodeGraph();
      });
      expect(keys()?.map((edge) => edge.source)).toEqual(["nts"]);
    } finally {
      toast.mockRestore();
    }
  });

  test("a drop on another Station's body says it takes no audio in", async () => {
    const { port, view } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    try {
      fireEvent.mouseDown(port("kexp", "out:audio:main"), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      const body = view.container.querySelector(
        '.react-flow__node[data-id="fip"]'
      );
      move(-5000, body);
      release(body);
      expect(toast.mock.calls).toEqual([
        ["A Station makes its own sound and takes no audio in"],
      ]);
    } finally {
      toast.mockRestore();
    }
  });
  test("an Audio input draws control in and audio out, an Output device draws audio in, and neither takes the wrong audio cable", async () => {
    const view = mountGraph(
      schema.nodeGraphSchema.parse({
        edges: [],
        nodes: [
          station("kexp"),
          {
            data: { deviceId: "mic", deviceLabel: "Desk mic" },
            id: "mic",
            position: at,
            type: "deviceIn",
          },
          {
            data: { deviceId: "usb", deviceLabel: "USB interface" },
            id: "desk",
            position: at,
            type: "deviceOut",
          },
          { data: {}, id: "speakers", position: at, type: "speakers" },
        ],
        version: 2,
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const handles = (node: string) =>
      [
        ...view.container.querySelectorAll(
          `.react-flow__handle[data-nodeid="${node}"]`
        ),
      ].map((element) => element.getAttribute("data-handleid"));

    expect(handles("mic")).toEqual(["in:control:parameter", "out:audio:main"]);
    expect(handles("desk")).toEqual(["in:audio:main"]);
    expect(
      view.container.querySelector('.react-flow__node[data-id="mic"]')
        ?.textContent
    ).toContain("Desk mic");

    const toast = spyOn(sonner, "toast");
    try {
      const out = view.container.querySelector(
        '.react-flow__handle[data-nodeid="kexp"][data-handleid="out:audio:main"]'
      ) as HTMLElement;
      fireEvent.mouseDown(out, { button: 0, clientX: 0, clientY: 0 });
      const mic = view.container.querySelector(
        '.react-flow__node[data-id="mic"]'
      );
      move(-5000, mic);
      release(mic);
      expect(toast.mock.calls).toEqual([
        ["An Audio input makes its own sound and takes no audio in"],
      ]);
    } finally {
      toast.mockRestore();
    }
  });

  test("a drop on a port on the cable's own side takes the node's one fitting port", async () => {
    const { port } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    try {
      fireEvent.mouseDown(port("kexp", "out:audio:main"), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      const reverbOut = port("verb", "out:audio:main");
      move(-5000, reverbOut);
      release(reverbOut);
      expect(toast).not.toHaveBeenCalled();
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toContainEqual(
        expect.objectContaining({
          source: "kexp",
          target: "verb",
          targetHandle: "in:audio:main",
        })
      );
    } finally {
      toast.mockRestore();
    }
  });

  /** Grabs the end of cable `edgeId` at its input, as a rewire starts. */
  const grabCableEnd = (
    container: HTMLElement,
    edgeId: string,
    side: "source" | "target" = "target"
  ) => {
    const end = container.querySelector(
      `.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-${side}`
    );
    if (!end) {
      throw new Error(`No cable end on ${edgeId}`);
    }
    fireEvent.mouseDown(end, { button: 0, clientX: 0, clientY: 0 });
  };

  async function mountControlPatch(parameter = "Q") {
    const view = mountGraph(
      schema.nodeGraphSchema.parse({
        edges: [
          {
            depth: -0.5,
            id: "modulation",
            parameter,
            source: "macro",
            sourceHandle: "out:control:main",
            target: "filter",
            targetHandle: "in:control:parameter",
          },
          {
            id: "occupied-source-default",
            parameter: "frequency",
            source: "other",
            sourceHandle: "out:control:main",
            target: "filter",
            targetHandle: "in:control:parameter",
          },
          {
            id: "occupied-target-default",
            parameter: "frequency",
            source: "macro",
            sourceHandle: "out:control:main",
            target: "other-filter",
            targetHandle: "in:control:parameter",
          },
        ],
        nodes: [
          { id: "macro", position: at, type: "macro" },
          { id: "other", position: at, type: "macro" },
          { data: {}, id: "filter", position: at, type: "filter" },
          { data: {}, id: "other-filter", position: at, type: "filter" },
          { data: {}, id: "pan", position: at, type: "pan" },
          { id: "speakers", position: at, type: "speakers" },
        ],
        version: 2,
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const port = (node: string, handle: string): HTMLElement => {
      const found = view.container.querySelector(
        `.react-flow__handle[data-nodeid="${node}"][data-handleid="${handle}"]`
      );
      if (!(found instanceof HTMLElement)) {
        throw new Error(`Missing control port ${node} ${handle}`);
      }
      return found;
    };
    return { port, view };
  }

  test.each(["source", "target"] as const)(
    "rewiring a Q cable's %s end keeps its cached parameter verdict despite an occupied Cutoff",
    async (side) => {
      const { port, view } = await mountControlPatch();
      const before = nodeStoreModule.nodeStore.state.graph;
      const toast = spyOn(sonner, "toast");
      const validate = spyOn(validateModule, "validateConnection");
      try {
        grabCableEnd(view.container, "modulation", side);
        move(-5000);
        const otherPort =
          side === "source"
            ? port("other", "out:control:main")
            : port("other-filter", "in:control:parameter");
        expect(otherPort.classList.contains("node-port-accept")).toBe(true);
        const validations = validate.mock.calls.length;
        move(-4990, otherPort);
        move(-4980, otherPort);
        expect(validate).toHaveBeenCalledTimes(validations);
        release(otherPort);
        expect(toast).not.toHaveBeenCalled();
        const next = nodeStoreModule.nodeStore.state.graph;
        expect(
          next?.edges.find((edge) => edge.id === "modulation")
        ).toMatchObject({
          depth: -0.5,
          parameter: "Q",
          source: side === "source" ? "other" : "macro",
          target: side === "source" ? "filter" : "other-filter",
        });
        expect(next && validateModule.validate(next)).toEqual([]);
        act(() => {
          nodeStoreModule.undoNodeGraph();
        });
        expect(nodeStoreModule.nodeStore.state.graph).toEqual(before);
      } finally {
        validate.mockRestore();
        toast.mockRestore();
      }
    }
  );

  test("rewiring Cutoff modulation to Pan resets the parameter before validation and commit", async () => {
    const { port, view } = await mountControlPatch("frequency");
    const toast = spyOn(sonner, "toast");
    try {
      grabCableEnd(view.container, "modulation");
      const target = port("pan", "in:control:parameter");
      move(-5000, target);
      expect(target.classList.contains("node-port-accept")).toBe(true);
      release(target);
      const next = nodeStoreModule.nodeStore.state.graph;
      const reconnected = next?.edges.find((edge) => edge.id === "modulation");
      expect(reconnected).toMatchObject({ depth: -0.5, target: "pan" });
      expect(reconnected?.parameter).toBeUndefined();
      expect(next && validateModule.validate(next)).toEqual([]);
      expect(toast).not.toHaveBeenCalled();
    } finally {
      toast.mockRestore();
    }
  });

  test("dragging a cable's end frees the input it leaves and rewires it in one undo step", async () => {
    const { port, view } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    try {
      grabCableEnd(view.container, "fip->comp");
      move(-5000);
      // The Compressor input the cable leaves takes it back, or another.
      expect(
        port("comp", "in:audio:main").classList.contains("node-port-accept")
      ).toBe(true);
      const reverbIn = port("verb", "in:audio:main");
      move(-4990, reverbIn);
      release(reverbIn);

      expect(toast).not.toHaveBeenCalled();
      const edges = () => nodeStoreModule.nodeStore.state.graph?.edges ?? [];
      expect(edges().map((edge) => `${edge.source}->${edge.target}`)).toEqual(
        expect.arrayContaining(["fip->verb"])
      );
      expect(edges().find((edge) => edge.id === "fip->comp")).toMatchObject({
        source: "fip",
        target: "verb",
      });

      act(() => {
        nodeStoreModule.undoNodeGraph();
      });
      expect(edges().some((edge) => edge.id === "fip->comp")).toBe(true);
      expect(edges().some((edge) => edge.target === "verb")).toBe(false);
    } finally {
      toast.mockRestore();
    }
  });

  test("a rewired cable removed during its drag offers no Replace", async () => {
    const { port, view } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    try {
      grabCableEnd(view.container, "nts->speakers");
      const compIn = port("comp", "in:audio:main");
      move(-5000, compIn);
      // Another tab removes the cable before it is let go.
      act(() => {
        nodeStoreModule.commitNodeGraph(
          (current) => ({
            ...current,
            edges: current.edges.filter((edge) => edge.id !== "nts->speakers"),
          }),
          nodeStoreModule.nodeStore,
          "snapshot"
        );
      });
      release(compIn);
      expect(toast).not.toHaveBeenCalled();
      expect(
        nodeStoreModule.nodeStore.state.graph?.edges.some(
          (edge) => edge.id === "nts->speakers"
        )
      ).toBe(false);
    } finally {
      toast.mockRestore();
    }
  });

  test("rewiring into an occupied input preserves the original cable", async () => {
    const { port, view } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    try {
      grabCableEnd(view.container, "nts->speakers");
      const input = port("comp", "in:audio:main");
      move(-5000, input);
      release(input);
      const edges = nodeStoreModule.nodeStore.state.graph?.edges ?? [];
      expect(edges.some((edge) => edge.id === "fip->comp")).toBe(true);
      expect(edges.find((edge) => edge.id === "nts->speakers")).toMatchObject({
        source: "nts",
        target: "comp",
        targetHandle: "in:audio:main",
      });
      expect(toast).not.toHaveBeenCalled();
      act(() => {
        nodeStoreModule.undoNodeGraph();
      });
      expect(
        nodeStoreModule.nodeStore.state.graph?.edges.find(
          (edge) => edge.id === "nts->speakers"
        )?.target
      ).toBe("speakers");
    } finally {
      toast.mockRestore();
    }
  });

  test("a cable end let go on empty space unplugs the cable", async () => {
    const { view } = await mountPatch();
    grabCableEnd(view.container, "fip->comp");
    const pane = view.container.querySelector(".react-flow__pane");
    move(-5000, pane);
    release(pane);

    expect(
      nodeStoreModule.nodeStore.state.graph?.edges.map((edge) => edge.id)
    ).not.toContain("fip->comp");
  });

  test("tap-then-tap lights the ports after the first tap and connects to an occupied input", async () => {
    const { port } = await mountPatch();
    const toast = spyOn(sonner, "toast");
    const tap = (element: HTMLElement) => {
      elementUnderPointer = element;
      fireEvent.click(element);
    };
    try {
      tap(port("kexp", "out:audio:main"));
      expect(
        port("verb", "in:audio:main").classList.contains("node-port-accept")
      ).toBe(true);
      const key = port("comp", "in:sidechain:key");
      expect(key.classList.contains("node-port-accept")).toBe(true);
      expect(key.title).toBe("Key input");

      tap(key);
      expect(toast).not.toHaveBeenCalled();
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(5);
      expect(
        port("verb", "in:audio:main").classList.contains("node-port-accept")
      ).toBe(false);

      tap(port("kexp", "out:audio:main"));
      tap(port("verb", "in:audio:main"));
      expect(toast).not.toHaveBeenCalled();
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(6);
    } finally {
      toast.mockRestore();
    }
  });
});

test("a cable into Split's control input is labeled as routing at unity, with no parameter picker", async () => {
  const position = { x: 0, y: 0 };
  const graph = schema.nodeGraphSchema.parse({
    edges: [
      {
        id: "control",
        source: "sum",
        sourceHandle: "out:control:main",
        target: "split",
        targetHandle: "in:control:main",
      },
    ],
    nodes: [
      { data: {}, id: "sum", position, type: "merge" },
      {
        data: {
          effect: catalogue.createNodeEffectConfig("fxComposite", "split"),
        },
        id: "split",
        position,
        type: "fxComposite",
      },
      { data: {}, id: "speakers", position, type: "speakers" },
    ],
    version: 2,
  });
  const view = mountGraph(graph);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const cable = view.getByRole("button", { name: "Edit Control modulation" });
  expect(cable.textContent).toContain("100%");
  fireEvent.click(cable);
  expect(
    view.queryByRole("combobox", { name: "Modulation target parameter" })
  ).toBeNull();
  expect(
    view.getByText("Depth scales the incoming control signal.", {
      exact: false,
    })
  ).toBeTruthy();
});
