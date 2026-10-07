/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
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
let branchSummary: typeof import("./branch-controls")["branchSummary"];
let BranchControls: typeof import("./branch-controls")["BranchControls"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let nodeGraphSchema: typeof import("@/lib/node-graph/schema")["nodeGraphSchema"];
let createNodeEffectConfig: typeof import("@/lib/node-graph/catalogue")["createNodeEffectConfig"];
let setBandCount: typeof import("@/lib/node-graph/branches")["setBandCount"];
let moduleFrame: typeof import("./module-frame");

beforeAll(async () => {
  ({ MergeNodeBody } = await import("./merge-node"));
  ({ SplitInspectorParams } = await import("./split-nodes"));
  ({ BranchControls, branchSummary } = await import("./branch-controls"));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  ({ nodeGraphSchema } = await import("@/lib/node-graph/schema"));
  ({ createNodeEffectConfig } = await import("@/lib/node-graph/catalogue"));
  ({ setBandCount } = await import("@/lib/node-graph/branches"));
  moduleFrame = await import("./module-frame");
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
      { id: "speakers", position, type: "speakers" },
    ],
    version: 2,
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
  test("shows the compiler's badge when it closes a split", () => {
    const view = render(
      <MergeNodeBody data={{ inputs: 2, role: "closes" }} onRemove={noop} />
    );
    const badge = view.getByText("closes");
    expect(badge.getAttribute("title")).toContain("branches");
    expect(view.getByText("2 inputs")).toBeTruthy();
  });

  test("a Merge summing stations reads sum", () => {
    const view = render(
      <MergeNodeBody data={{ inputs: 9, role: "sum" }} onRemove={noop} />
    );
    expect(view.getByText("sum").getAttribute("title")).toContain("Mixes");
    expect(view.getByText("9 inputs")).toBeTruthy();
  });

  test("labels one incoming audio cable in the singular", () => {
    const view = render(
      <MergeNodeBody data={{ inputs: 1, role: null }} onRemove={noop} />
    );
    expect(view.getByText("1 input")).toBeTruthy();
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
    expect(
      branches.getByRole("slider", { name: "Low cable trim" })
    ).toBeTruthy();
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
      baseGain: 1,
      basePan: 0,
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

  test("shows a configured chain pan added to the cable's own", () => {
    const store = createStore();
    const data = {
      baseGain: 1,
      basePan: 0.5,
      gain: 1,
      muted: false,
      name: "Branch 1",
      pan: 0.2,
      solo: false,
      tag: "1",
    };
    const view = render(
      <BranchControls data={data} edgeId="branch" store={store} />
    );

    expect(branchSummary(data)).toEqual(["R70"]);
    expect(branchSummary({ ...data, pan: 0.8 })).toEqual(["R100"]);
    expect(view.getByText("Pan base R50 · base + cable R70")).toBeTruthy();
    // The knob still turns the cable's own pan.
    expect(
      view
        .getByRole("slider", { name: "Branch 1 pan" })
        .getAttribute("aria-valuenow")
    ).toBe("0.2");
  });

  test("includes the Split base attenuation without changing the cable trim", () => {
    const store = createStore();
    const before = store.state.graph;
    const data = {
      baseGain: Math.SQRT1_2,
      basePan: 0,
      gain: 0.5,
      muted: false,
      name: "Branch 1",
      pan: 0,
      solo: false,
      tag: "1",
    };
    const view = render(
      <BranchControls data={data} edgeId="branch" store={store} />
    );
    expect(view.getByText("Base -3.0 dB · base + trim -9.0 dB")).toBeTruthy();
    expect(
      view
        .getByRole("slider", { name: "Branch 1 cable trim" })
        .getAttribute("aria-valuenow")
    ).toBe("0.5");
    expect(store.state.graph).toBe(before);
    expect(branchSummary({ ...data, gain: 1 })).toEqual(["-3.0 dB"]);
    expect(branchSummary(data)).toEqual(["-9.0 dB"]);
    expect(branchSummary({ ...data, gain: 0 })).toEqual(["-∞ dB"]);
  });
});

describe("split ports", () => {
  test("draw only on the canvas, and re-measure when a branch port comes or goes", () => {
    const { FlowPortsProvider, ModulePorts } = moduleFrame;
    const updateNodeInternals = mock((_id: string | string[]) => undefined);
    const ports = {
      Port: ({ port, label }: import("./module-frame").NodePortProps) => (
        <span
          data-handle={`${port.direction}:${port.kind}:${port.id}`}
          title={label}
        />
      ),
      Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
      updateNodeInternals,
    } as unknown as import("./module-frame").FlowPorts;
    const split = (outputIds: string[]) => (
      <ModulePorts
        nodeId="split"
        outputIds={outputIds}
        outputLabel={(port) => `Branch ${port.id.split("-").at(-1)}`}
        title="Split"
        type="fxComposite"
      />
    );

    // The Stage, Rack and inspector have no React Flow, so no ports.
    const bare = render(split(["branch-1", "branch-2"]));
    expect(bare.container.querySelector("[data-handle]")).toBeNull();
    bare.unmount();

    const view = render(
      <FlowPortsProvider value={ports}>
        {split(["branch-1", "branch-2"])}
      </FlowPortsProvider>
    );
    const handles = () =>
      [...view.container.querySelectorAll("[data-handle]")].map((handle) =>
        handle.getAttribute("data-handle")
      );
    expect(handles()).toEqual([
      "in:audio:main",
      "in:control:parameter",
      "out:audio:branch-1",
      "out:audio:branch-2",
    ]);
    // Only the outputs are named for their branches; the input is an input.
    expect(
      [...view.container.querySelectorAll("[data-handle]")].map((handle) =>
        handle.getAttribute("title")
      )
    ).toEqual(["Input", "Parameter input", "Branch 1", "Branch 2"]);
    const measured = updateNodeInternals.mock.calls.length;

    view.rerender(
      <FlowPortsProvider value={ports}>
        {split(["branch-1", "branch-2", "branch-3"])}
      </FlowPortsProvider>
    );
    expect(handles()).toContain("out:audio:branch-3");
    expect(updateNodeInternals.mock.calls.slice(measured)).toEqual([["split"]]);

    // Nothing changed, so nothing to re-measure.
    view.rerender(
      <FlowPortsProvider value={ports}>
        {split(["branch-1", "branch-2", "branch-3"])}
      </FlowPortsProvider>
    );
    expect(updateNodeInternals.mock.calls.length).toBe(measured + 1);
  });
});
