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
let NodeCanvasHint: typeof import("./canvas-hint")["NodeCanvasHint"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let templates: typeof import("@/lib/node-graph/templates");
let validateModule: typeof import("@/lib/node-graph/validate");
let sonner: typeof import("sonner");
let catalogue: typeof import("@/lib/node-graph/catalogue");
let schema: typeof import("@/lib/node-graph/schema");

beforeAll(async () => {
  ({ default: NodeCanvas } = await import("./node-canvas"));
  ({ NodeCanvasHint } = await import("./canvas-hint"));
  ({ NodeActionsProvider } = await import("./node-actions"));
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
  return mountGraph(templates.buildNodeGraphFromTemplate("starter"));
}

function mountGraph(graph: import("@/lib/node-graph/schema").NodeGraph) {
  nodeStoreModule.loadNodeGraph(graph);
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
      version: 1,
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
      ["comp", "in:sidechain:key"],
      ["comp", "in:audio:main"],
    ] as const) {
      expect(locked(port(node, handle))).toBe(true);
    }
    expect(port("fip", "out:audio:main").title).toBe(
      validateModule.SAME_SIDE_MESSAGE
    );
    expect(port("comp", "in:sidechain:key").title).toBe(
      "This input takes one cable"
    );
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
      // One per input in the patch: Compressor in and key, Reverb in,
      // Speakers in. Stations have no shipped inputs.
      expect(spy).toHaveBeenCalledTimes(4);

      const speakersIn = port("speakers", "in:audio:main");
      for (const x of [-4990, -4980, -4970]) {
        move(x, speakersIn);
      }
      move(-4960, port("comp", "in:sidechain:key"));
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
      release(null);
    }
  });

  test("a drop on a locked port says why in one toast", async () => {
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
      expect(toast.mock.calls).toEqual([["This input takes one cable"]]);
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(4);
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
});
