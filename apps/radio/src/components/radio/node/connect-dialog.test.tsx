/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";

const OCCUPIED_SOURCE = /NTS 1 audio/;

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
  Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  PointerEvent: dom.window.PointerEvent,
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
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

// Radix Select measures and scrolls, which JSDOM does not do.
for (const [key, value] of Object.entries({
  hasPointerCapture: (): boolean => false,
  releasePointerCapture: (): void => undefined,
  scrollIntoView: (): void => undefined,
})) {
  Object.defineProperty(dom.window.HTMLElement.prototype, key, {
    configurable: true,
    value,
    writable: true,
  });
}

let ConnectDialog: typeof import("./connect-dialog")["ConnectDialog"];
let RewireDialog: typeof import("./rewire-dialog")["RewireDialog"];
let NodeToolbar: typeof import("./node-toolbar")["NodeToolbar"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let createPaletteNode: typeof import("@/lib/node-graph/palette")["createPaletteNode"];
let createNodeStore: typeof import("@/lib/node-graph/node-store")["createNodeStore"];
let buildNodeGraphFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeGraphFromTemplate"];

beforeAll(async () => {
  ({ ConnectDialog } = await import("./connect-dialog"));
  ({ RewireDialog } = await import("./rewire-dialog"));
  ({ NodeToolbar } = await import("./node-toolbar"));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  ({ createPaletteNode } = await import("@/lib/node-graph/palette"));
  ({ createNodeStore } = await import("@/lib/node-graph/node-store"));
  ({ buildNodeGraphFromTemplate } = await import("@/lib/node-graph/templates"));
});

describe("selected cable rewiring", () => {
  test("a selected cable exposes a tap and keyboard action in the toolbar", () => {
    const store = seededStore();
    const edgeId = store.state.graph?.edges[0]?.id ?? "";
    nodeStoreModule.setNodeSelection({ edges: [edgeId], nodes: [] }, store);
    const opened: string[] = [];
    const view = render(
      <NodeToolbar
        onAdd={() => undefined}
        onLoadTemplate={() => undefined}
        onRewire={(id) => {
          opened.push(id);
        }}
        store={store}
      />
    );
    const button = view.getByRole("button", { name: "Rewire selected cable" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(opened).toEqual([edgeId]);
  });

  test("tap controls rewire a branch, preserve its settings and undo in one step", async () => {
    const initial = buildNodeGraphFromTemplate("start-from-multiple", {
      saved: [radio("kexp", "KEXP")],
    });
    const branch = {
      color: "cyan",
      gain: 0.5,
      id: "branch",
      muted: false,
      pan: -0.75,
      solo: true,
      source: "split",
      sourceHandle: "out:audio:branch-1",
      target: "comp",
      targetHandle: "in:audio:main",
    };
    const cable = (source: string, target: string, handle = "main") => ({
      ...branch,
      id: `${source}->${target}`,
      source,
      sourceHandle: `out:audio:${handle}`,
      target,
    });
    const nodes = [
      createPaletteNode("fxComposite", "split", { x: 0, y: 0 }),
      createPaletteNode("compressor", "comp", { x: 0, y: 0 }),
      createPaletteNode("merge", "merge", { x: 0, y: 0 }),
    ].filter((node): node is NonNullable<typeof node> => node !== null);
    const graph = {
      ...initial,
      edges: [
        cable("src-kexp", "split"),
        branch,
        cable("comp", "merge"),
        cable("split", "merge", "branch-2"),
        cable("merge", "speakers"),
      ],
      nodes: [...initial.nodes, ...nodes],
    };
    const store = createNodeStore(graph);
    let closed = false;
    const view = render(
      <RewireDialog
        edgeId="branch"
        onClose={() => {
          closed = true;
        }}
        store={store}
      />
    );
    expect(
      view.getByRole("button", { name: "Rewire" }).hasAttribute("disabled")
    ).toBe(true);
    const trigger = view.getByRole("combobox", { name: "New port" });
    fireEvent.pointerDown(trigger, {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(trigger, {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.click(trigger);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const invalid = view
      .getAllByRole("option")
      .find((option) => option.textContent?.startsWith("Split input"));
    expect(invalid?.getAttribute("aria-disabled")).toBe("true");
    expect(invalid?.textContent).toContain(" — ");
    const merge = view.getByRole("option", { name: "Merge input" });
    fireEvent.pointerDown(merge, {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.click(merge);
    fireEvent.click(view.getByRole("button", { name: "Rewire" }));
    expect(closed).toBe(true);
    expect(
      store.state.graph?.edges.find((edge) => edge.id === "branch")
    ).toEqual({
      ...branch,
      target: "merge",
    });
    expect(store.state.history.past).toHaveLength(1);
    act(() => nodeStoreModule.undoNodeGraph(store));
    expect(store.state.graph).toEqual(graph);
  });

  test("keyboard selects a replacement source and an invalid choice cannot rewire", async () => {
    const store = seededStore();
    const edge = store.state.graph?.edges[0];
    if (!edge) {
      throw new Error("Expected a cable");
    }
    const view = render(
      <RewireDialog edgeId={edge.id} onClose={() => undefined} store={store} />
    );
    await openSelect(view.getByRole("combobox", { name: "Cable end" }));
    const source = view.getByRole("option", { name: "Source" });
    act(() => source.focus());
    fireEvent.keyDown(source, { key: "Enter" });
    await openSelect(view.getByRole("combobox", { name: "New port" }));
    const occupied = view.getByRole("option", { name: OCCUPIED_SOURCE });
    expect(occupied.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(occupied);
    expect(
      view
        .getByRole("button", { hidden: true, name: "Rewire" })
        .hasAttribute("disabled")
    ).toBe(true);
    const replacement = view.getByRole("option", { name: "BBC 4 audio" });
    act(() => replacement.focus());
    fireEvent.keyDown(replacement, { key: "Enter" });
    const submit = view.getByRole("button", { name: "Rewire" });
    submit.focus();
    fireEvent.submit(submit.closest("form") as HTMLFormElement);
    expect(
      store.state.graph?.edges.find((entry) => entry.id === edge.id)
    ).toEqual({
      ...edge,
      source: "src-bbc",
    });
    expect(store.state.history.past).toHaveLength(1);
  });
});

function radio(id: string, name: string): Radio {
  return {
    enabled: true,
    id,
    name,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

/** KEXP and NTS 1 wired to Speakers, and BBC 4 not wired yet. */
function seededStore() {
  const graph = buildNodeGraphFromTemplate("start-from-multiple", {
    saved: [
      radio("kexp", "KEXP"),
      radio("nts", "NTS 1"),
      radio("bbc", "BBC 4"),
    ],
  });
  return createNodeStore({
    ...graph,
    edges: graph.edges.filter((edge) => edge.source !== "src-bbc"),
  });
}

/** Opens a Radix Select, then lets its positioning frames settle. */
async function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

describe("ConnectDialog", () => {
  test("Speakers offers only the Station outputs not wired to it yet", async () => {
    const view = render(
      <ConnectDialog
        nodeId="speakers"
        onClose={() => undefined}
        store={seededStore()}
      />
    );

    expect(view.getByRole("dialog", { name: "Connect Speakers" })).toBeTruthy();
    expect(
      view.getByRole("combobox", { name: "Speakers port" }).textContent
    ).toBe("Input");
    const target = view.getByRole("combobox", { name: "Connect to" });
    await openSelect(target);

    const options = within(view.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "BBC 4 audio",
    ]);
  });

  test("confirming adds the cable and closes", async () => {
    const store = seededStore();
    let closed = false;
    const view = render(
      <ConnectDialog
        nodeId="src-bbc"
        onClose={() => {
          closed = true;
        }}
        store={store}
      />
    );

    expect(view.getByRole("combobox", { name: "BBC 4 port" }).textContent).toBe(
      "Audio out"
    );
    await openSelect(view.getByRole("combobox", { name: "Connect to" }));
    fireEvent.click(view.getByRole("option", { name: "Speakers input" }));
    fireEvent.click(view.getByRole("button", { name: "Connect" }));

    expect(closed).toBe(true);
    expect(store.state.graph?.edges.at(-1)).toMatchObject({
      source: "src-bbc",
      sourceHandle: "out:audio:main",
      target: "speakers",
      targetHandle: "in:audio:main",
    });
  });

  test("a node nothing can reach says so", () => {
    const view = render(
      <ConnectDialog
        nodeId="src-kexp"
        onClose={() => undefined}
        store={seededStore()}
      />
    );

    expect(
      view.getByText("Nothing can take a new cable from KEXP.")
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: "Connect" })).toBeNull();
  });
});
