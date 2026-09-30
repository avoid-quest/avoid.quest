/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, describe, expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useRef } from "react";
import type { Radio } from "@/lib/audio";

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
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
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

const { useCableSurgeryShortcuts } = await import("./cable-surgery");
const { useUndoShortcuts } = await import("./node-toolbar");
const { compile } = await import("@/lib/node-graph/compile");
const { insertNodeOnEdge } = await import("@/lib/node-graph/graph-edits");
const { seriesToParallel } = await import("@/lib/node-graph/series-parallel");
const { toast } = await import("sonner");
const { createNodeStore } = await import("@/lib/node-graph/node-store");
const { createPaletteNode } = await import("@/lib/node-graph/palette");
const { diff } = await import("@/lib/node-graph/reconcile");
const { buildNodeGraphFromTemplate } = await import(
  "@/lib/node-graph/templates"
);

type NodeGraph = import("@/lib/node-graph/schema").NodeGraph;
type NodeStore = import("@/lib/node-graph/node-store").NodeStore;
type PaletteRequest = import("./node-palette").PaletteRequest;

const ENV = { crossOriginIsolated: false };

function radio(id: string): Radio {
  return {
    enabled: true,
    id,
    name: id.toUpperCase(),
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

function withLoose(graph: NodeGraph, type: "compressor" | "delay") {
  const node = createPaletteNode(type, type, { x: 240, y: 0 });
  if (!node) {
    throw new Error(`Cannot create fixture ${type}`);
  }
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** KEXP → Compressor → Speakers, NTS → Speakers, and a loose Delay. */
function patch(): NodeGraph {
  const stations = buildNodeGraphFromTemplate("start-from-multiple", {
    saved: [radio("kexp"), radio("nts")],
  });
  const edit = insertNodeOnEdge(
    withLoose(stations, "compressor"),
    "compressor",
    "src-kexp->speakers"
  );
  if (!edit.ok) {
    throw new Error(edit.message);
  }
  return withLoose(edit.graph, "delay");
}

function Harness({
  store,
  onInsertInto,
}: {
  store: NodeStore;
  onInsertInto: (request: PaletteRequest) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  useCableSurgeryShortcuts({ canvasRef, onInsertInto, store });
  useUndoShortcuts(store);
  return (
    <>
      <div ref={canvasRef} />
      <input aria-label="Elsewhere" />
    </>
  );
}

function setup(selection: { nodes?: string[]; edges?: string[] }) {
  const start = patch();
  const store = createNodeStore(start);
  store.setState((state) => ({
    ...state,
    selection: { edges: selection.edges ?? [], nodes: selection.nodes ?? [] },
  }));
  const onInsertInto = mock((_request: PaletteRequest) => undefined);
  const view = render(<Harness onInsertInto={onInsertInto} store={store} />);
  return { onInsertInto, start, store, view };
}

function press(
  key: string,
  modifiers: { metaKey?: boolean; shiftKey?: boolean } = {},
  target: EventTarget = document.body
) {
  act(() => {
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...modifiers,
      })
    );
  });
}

function undo() {
  press("z", { metaKey: true });
}

function isEnabled(graph: NodeGraph | null, id: string): boolean | undefined {
  const node = graph?.nodes.find((entry) => entry.id === id);
  return (node?.data as { effect?: { enabled: boolean } } | undefined)?.effect
    ?.enabled;
}

function cables(graph: NodeGraph | null) {
  return (graph?.edges ?? []).map(
    (edge) => `${edge.id}: ${edge.source} -> ${edge.target}`
  );
}

describe("cable surgery shortcuts", () => {
  test("B bypasses the first FX and rebuilds its pre-mix signal gain; one Cmd+Z undoes it", () => {
    const { start, store } = setup({ nodes: ["compressor"] });

    press("b");

    expect(isEnabled(store.state.graph, "compressor")).toBe(false);
    const ops = diff(
      compile(start, ENV),
      compile(store.state.graph as NodeGraph, ENV)
    );
    expect(ops.map((op) => op.type)).toEqual([
      "duckLane",
      "replaceLaneEffects",
      "unduckLane",
    ]);

    undo();
    expect(store.state.graph).toBe(start);
  });

  test("Delete heals the path; one Cmd+Z undoes it", () => {
    const { start, store } = setup({ nodes: ["compressor"] });

    press("Delete");

    expect(cables(store.state.graph)).toEqual([
      "src-nts->speakers: src-nts -> speakers",
      "src-kexp->speakers: src-kexp -> speakers",
    ]);
    undo();
    expect(store.state.graph).toBe(start);
  });

  test("Delete refuses an unhealable Merge with a reason and keeps the whole selection", () => {
    const serial = insertNodeOnEdge(patch(), "delay", "compressor->speakers");
    if (!serial.ok) {
      throw new Error(serial.message);
    }
    const parallel = seriesToParallel(serial.graph, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!parallel.ok) {
      throw new Error(parallel.message);
    }
    const merge = parallel.graph.nodes.find((node) => node.type === "merge");
    const store = createNodeStore(parallel.graph);
    store.setState((state) => ({
      ...state,
      selection: { edges: ["src-nts->speakers"], nodes: [merge?.id ?? ""] },
    }));
    const before = store.state;
    const notifications = toast.getHistory().length;
    render(<Harness onInsertInto={mock()} store={store} />);

    press("Delete");

    expect(store.state).toBe(before);
    expect(compile(store.state.graph as NodeGraph, ENV).edges.size).toBe(2);
    const last = toast.getHistory().slice(notifications).at(-1);
    expect(last && "title" in last ? last.title : null).toContain(
      "disconnecting a source from its output"
    );
    undo();
    expect(store.state).toBe(before);
  });

  test("Cmd+D duplicates and selects the copies; one Cmd+Z undoes it", () => {
    const { start, store } = setup({ nodes: ["src-nts"] });

    press("d", { metaKey: true });

    expect(store.state.selection.nodes).toEqual(["src-nts-2"]);
    expect(cables(store.state.graph).at(-1)).toBe(
      "src-nts-2->speakers: src-nts-2 -> speakers"
    );
    undo();
    expect(store.state.graph).toBe(start);
  });

  test("I puts the selected loose node into the selected cable; one Cmd+Z undoes it", () => {
    const { onInsertInto, start, store } = setup({
      edges: ["src-nts->speakers"],
      nodes: ["delay"],
    });

    press("i");

    expect(onInsertInto).not.toHaveBeenCalled();
    expect(cables(store.state.graph)).toContain(
      "src-nts->speakers: src-nts -> delay"
    );
    expect(cables(store.state.graph)).toContain(
      "delay->speakers: delay -> speakers"
    );
    undo();
    expect(store.state.graph).toBe(start);
  });

  test("I on a cable alone asks what goes into it, halfway along", () => {
    const { onInsertInto, start, store } = setup({
      edges: ["src-nts->speakers"],
    });

    press("i");

    expect(store.state.graph).toBe(start);
    const nts = start.nodes.find((node) => node.id === "src-nts");
    const speakers = start.nodes.find((node) => node.id === "speakers");
    expect(onInsertInto).toHaveBeenCalledWith({
      into: "src-nts->speakers",
      position: {
        x: ((nts?.position.x ?? 0) + (speakers?.position.x ?? 0)) / 2,
        y: ((nts?.position.y ?? 0) + (speakers?.position.y ?? 0)) / 2,
      },
    });
  });

  test("keys typed into a field leave the patch alone", () => {
    const { start, store, view } = setup({ nodes: ["compressor"] });
    const field = view.getByRole("textbox", { name: "Elsewhere" });

    press("b", {}, field);
    press("Delete", {}, field);
    press("d", { metaKey: true }, field);

    expect(store.state.graph).toBe(start);
  });
});
