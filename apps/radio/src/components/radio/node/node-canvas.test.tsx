/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { ExternalToast } from "sonner";

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
let NodeCanvasHint: typeof import("./canvas-hint")["NodeCanvasHint"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let templates: typeof import("@/lib/node-graph/templates");
let validateModule: typeof import("@/lib/node-graph/validate");
let sonner: typeof import("sonner");
let catalogue: typeof import("@/lib/node-graph/catalogue");
let schema: typeof import("@/lib/node-graph/schema");

beforeAll(async () => {
  ({ default: NodeCanvas, phoneFitViewport } = await import("./node-canvas"));
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
      const [[message, options]] = toast.mock.calls as [
        [string, ExternalToast],
      ];
      expect(message).toBe("This input takes one cable");
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(4);

      // Replace moves the key's cable to KEXP, in one undo step.
      const action = options.action as { label: string; onClick: () => void };
      expect(action.label).toBe("Replace");
      action.onClick();
      const keys = nodeStoreModule.nodeStore.state.graph?.edges.filter(
        (edge) =>
          edge.target === "comp" && edge.targetHandle === "in:sidechain:key"
      );
      expect(keys?.map((edge) => edge.source)).toEqual(["kexp"]);
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(4);
    } finally {
      toast.mockRestore();
    }
  });

  test("Replace leaves alone a port's cable moved since the toast", async () => {
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
      const [[, options]] = toast.mock.calls as [[string, ExternalToast]];
      const action = options.action as { label: string; onClick: () => void };

      // The key's cable goes to the Reverb before Replace is clicked.
      act(() => {
        nodeStoreModule.commitNodeGraph(
          (current) => ({
            ...current,
            edges: current.edges.map((edge) =>
              edge.id === "nts->comp"
                ? { ...edge, target: "verb", targetHandle: "in:audio:main" }
                : edge
            ),
          }),
          nodeStoreModule.nodeStore,
          "snapshot"
        );
      });
      const moved = nodeStoreModule.nodeStore.state.graph;
      action.onClick();
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toEqual(
        moved?.edges ?? []
      );
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
  test("an Audio input draws only an audio out, an Output device only an audio in, and neither takes the wrong cable", async () => {
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

    expect(handles("mic")).toEqual(["out:audio:main"]);
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
  const grabCableEnd = (container: HTMLElement, edgeId: string) => {
    const end = container.querySelector(
      `.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-target`
    );
    if (!end) {
      throw new Error(`No cable end on ${edgeId}`);
    }
    fireEvent.mouseDown(end, { button: 0, clientX: 0, clientY: 0 });
  };

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

  test("tap-then-tap lights the ports after the first tap and explains a refused second tap", async () => {
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
      expect(key.classList.contains("node-port-locked")).toBe(true);
      expect(key.title).toBe("This input takes one cable");

      tap(key);
      expect(toast.mock.calls.map(([message]) => message)).toEqual([
        "This input takes one cable",
      ]);
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(4);
      expect(
        port("verb", "in:audio:main").classList.contains("node-port-accept")
      ).toBe(false);

      tap(port("kexp", "out:audio:main"));
      tap(port("verb", "in:audio:main"));
      expect(toast).toHaveBeenCalledTimes(1);
      expect(nodeStoreModule.nodeStore.state.graph?.edges).toHaveLength(5);
    } finally {
      toast.mockRestore();
    }
  });
});
