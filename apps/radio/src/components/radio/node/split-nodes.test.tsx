/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
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

// JSDOM has no canvas; effect curves draw nothing.
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

let MergeNodeBody: typeof import("./merge-node")["MergeNodeBody"];
let SplitInspectorParams: typeof import("./split-nodes")["SplitInspectorParams"];
let branchSummary: typeof import("./branch-edge")["branchSummary"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let nodeGraphSchema: typeof import("@/lib/node-graph/schema")["nodeGraphSchema"];
let createNodeEffectConfig: typeof import("@/lib/node-graph/catalogue")["createNodeEffectConfig"];
let setBandCount: typeof import("@/lib/node-graph/branches")["setBandCount"];
let BUS_MERGE_MESSAGE: string;

beforeAll(async () => {
  ({ MergeNodeBody } = await import("./merge-node"));
  ({ SplitInspectorParams } = await import("./split-nodes"));
  ({ branchSummary } = await import("./branch-edge"));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  ({ nodeGraphSchema } = await import("@/lib/node-graph/schema"));
  ({ createNodeEffectConfig } = await import("@/lib/node-graph/catalogue"));
  ({ setBandCount } = await import("@/lib/node-graph/branches"));
  ({ BUS_MERGE_MESSAGE } = await import("@/lib/node-graph/validate"));
});

afterEach(cleanup);

const noop = () => undefined;
const position = { x: 0, y: 0 };

/** KEXP → Band Split (3 bands) → Crusher on the lows, the rest straight on → Merge. */
function createStore() {
  const band = (port: number, target: string) => ({
    id: `bands.band-${port}`,
    source: "bands",
    sourceHandle: `out:audio:band-${port}`,
    target,
    targetHandle: "in:audio:main",
  });
  const graph = nodeGraphSchema.parse({
    edges: [
      {
        id: "kexp->bands",
        source: "kexp",
        sourceHandle: "out:audio:main",
        target: "bands",
        targetHandle: "in:audio:main",
      },
      band(1, "crush"),
      band(2, "mix"),
      band(3, "mix"),
      {
        id: "crush->mix",
        source: "crush",
        sourceHandle: "out:audio:main",
        target: "mix",
        targetHandle: "in:audio:main",
      },
    ],
    nodes: [
      {
        data: {
          radio: { id: "kexp", name: "KEXP", streamUrl: "https://kexp.test" },
        },
        id: "kexp",
        position,
        type: "station",
      },
      {
        data: { effect: createNodeEffectConfig("frequencySplit", "bands") },
        id: "bands",
        position,
        type: "frequencySplit",
      },
      {
        data: { effect: createNodeEffectConfig("crusher", "crush") },
        id: "crush",
        position,
        type: "crusher",
      },
      { data: {}, id: "mix", position, type: "merge" },
    ],
    version: 1,
  });
  return nodeStoreModule.createNodeStore(setBandCount(graph, "bands", 3));
}

function splitNode(store: ReturnType<typeof createStore>) {
  const node = store.state.graph?.nodes.find((entry) => entry.id === "bands");
  if (node?.type !== "frequencySplit") {
    throw new Error("Expected the Band Split");
  }
  return node as Parameters<typeof SplitInspectorParams>[0]["node"];
}

describe("Merge node", () => {
  test("shows the compiler's in-lane badge", () => {
    const view = render(
      <MergeNodeBody data={{ inputs: 2, role: "in-lane" }} onRemove={noop} />
    );
    const badge = view.getByText("in-lane");
    expect(badge.getAttribute("title")).toContain("one station");
    expect(view.getByText("2 of 8 inputs")).toBeTruthy();
  });

  test("a Merge summing stations reads bus, with the reason", () => {
    const view = render(
      <MergeNodeBody data={{ inputs: 2, role: "bus" }} onRemove={noop} />
    );
    expect(view.getByText("bus").getAttribute("title")).toBe(BUS_MERGE_MESSAGE);
    expect(view.queryByText("in-lane")).toBeNull();
  });
});

describe("Split inspector", () => {
  test("lists each branch cable with its controls, and no nested effects", () => {
    const store = createStore();
    const view = render(
      <SplitInspectorParams node={splitNode(store)} store={store} />
    );
    const branches = within(view.getByRole("region", { name: "Branches" }));

    expect(
      branches.getAllByRole("listitem").map((item) => item.textContent)
    ).toEqual([
      expect.stringContaining("Low to Crusher"),
      expect.stringContaining("Mid to Merge"),
      expect.stringContaining("High to Merge"),
    ]);
    expect(branches.getByRole("slider", { name: "Low gain" })).toBeTruthy();
    expect(branches.getByRole("slider", { name: "Mid pan" })).toBeTruthy();
    expect(view.queryByText("Add nested effect")).toBeNull();
    expect(view.queryByText("Add parallel chain")).toBeNull();
    expect(
      view.getByRole("slider", { name: "Band Split crossover 2" })
    ).toBeTruthy();
  });

  test("Mute and Solo edit the branch cable, each as one undo step", () => {
    const store = createStore();
    const before = store.state.graph;
    const view = render(
      <SplitInspectorParams node={splitNode(store)} store={store} />
    );

    act(() => {
      fireEvent.click(view.getByRole("button", { name: "Solo Mid" }));
    });
    const cable = () =>
      store.state.graph?.edges.find((edge) => edge.id === "bands.band-2");
    expect(cable()?.solo).toBe(true);
    expect(view.getByRole("button", { name: "Solo Mid" })).toHaveProperty(
      "ariaPressed",
      "true"
    );

    act(() => {
      nodeStoreModule.undoNodeGraph(store);
    });
    expect(store.state.graph).toBe(before);
  });
});

describe("branch tag", () => {
  test("says what differs from a unity, centred branch", () => {
    const data = {
      gain: 1,
      muted: false,
      name: "Low",
      pan: 0,
      solo: false,
      tag: "Low",
    };
    expect(branchSummary(data)).toEqual([]);
    expect(
      branchSummary({ ...data, gain: 0.5, muted: true, pan: -0.4, solo: true })
    ).toEqual(["-6.0 dB", "L40", "M", "S"]);
  });
});
