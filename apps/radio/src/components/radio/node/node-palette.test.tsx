/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";
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
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

let NodePalette: typeof import("./node-palette")["NodePalette"];
let usePaletteShortcut: typeof import("./node-palette")["usePaletteShortcut"];
let createNodeStore: typeof import("@/lib/node-graph/node-store")["createNodeStore"];
let undoNodeGraph: typeof import("@/lib/node-graph/node-store")["undoNodeGraph"];
let buildNodeGraphFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeGraphFromTemplate"];

beforeAll(async () => {
  ({ NodePalette, usePaletteShortcut } = await import("./node-palette"));
  ({ createNodeStore, undoNodeGraph } = await import(
    "@/lib/node-graph/node-store"
  ));
  ({ buildNodeGraphFromTemplate } = await import("@/lib/node-graph/templates"));
});

type Request = import("./node-palette").PaletteRequest;
type Store = import("@/lib/node-graph/node-store").NodeStore;

function radio(id: string, name: string): Radio {
  return {
    enabled: true,
    id,
    name,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

const kexp = radio("kexp", "KEXP");
const nts = radio("nts", "NTS 1");

function seededStore(): Store {
  return createNodeStore(
    buildNodeGraphFromTemplate("start-from-multiple", { saved: [kexp] })
  );
}

/** The palette as the mode mounts it: `/` opens it, a pick closes it. */
function PaletteHarness({
  store,
  initial = null,
  onLoadTemplate = () => undefined,
}: {
  store: Store;
  initial?: Request | null;
  onLoadTemplate?: (template: string) => void;
}) {
  const [request, setRequest] = useState<Request | null>(initial);
  usePaletteShortcut(() => setRequest({}));
  return (
    <>
      <input aria-label="Elsewhere" />
      <NodePalette
        onClose={() => setRequest(null)}
        onLoadTemplate={onLoadTemplate}
        radios={[kexp, nts]}
        request={request}
        store={store}
      />
    </>
  );
}

function pressSlash(target: EventTarget) {
  act(() => {
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "/",
      })
    );
  });
}

describe("NodePalette", () => {
  test("/ opens the palette, but not while typing", () => {
    const view = render(<PaletteHarness store={seededStore()} />);

    pressSlash(view.getByRole("textbox", { name: "Elsewhere" }));
    expect(view.queryByRole("dialog")).toBeNull();

    pressSlash(document.body);
    const dialog = view.getByRole("dialog", { name: "Add node" });
    expect(dialog).toBeTruthy();
    expect(view.getByRole("region", { name: "Sources" })).toBeTruthy();
    expect(view.getByRole("region", { name: "Templates" })).toBeTruthy();
  });

  test("Enter adds the first match, wired to Speakers, as one undo step", () => {
    const store = seededStore();
    const view = render(<PaletteHarness initial={{}} store={store} />);

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "nts" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(view.queryByRole("dialog")).toBeNull();
    const { graph } = store.state;
    expect(graph?.nodes.find((node) => node.id === "src-nts")).toMatchObject({
      data: { radio: nts },
      type: "station",
    });
    expect(graph?.edges.at(-1)).toMatchObject({
      source: "src-nts",
      target: "speakers",
    });

    act(() => {
      undoNodeGraph(store);
    });
    expect(store.state.graph?.nodes.some((node) => node.id === "src-nts")).toBe(
      false
    );
  });

  test("a template entry loads the template", () => {
    const onLoadTemplate = mock((_template: string) => undefined);
    const view = render(
      <PaletteHarness
        initial={{}}
        onLoadTemplate={onLoadTemplate}
        store={seededStore()}
      />
    );

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "blank" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onLoadTemplate).toHaveBeenCalledWith("blank");
  });

  test("a cable dropped from an input offers only what feeds it, and wires it", () => {
    const store = seededStore();
    const view = render(
      <PaletteHarness
        initial={{
          from: { handle: "in:audio:main", node: "speakers", type: "target" },
          position: { x: -400, y: 320 },
        }}
        store={store}
      />
    );

    expect(
      view.getByRole("dialog", { name: "Add a node to this cable" })
    ).toBeTruthy();
    expect(view.queryByRole("region", { name: "Templates" })).toBeNull();
    const names = view
      .getAllByRole("button")
      .map((button) => button.querySelector("h3")?.textContent)
      .filter(Boolean);
    expect(names).toEqual(["Station", "KEXP", "NTS 1"]);

    fireEvent.keyDown(
      view.getByRole("searchbox", { name: "Search nodes and stations" }),
      { key: "Enter" }
    );

    const slot = store.state.graph?.nodes.find(
      (node) => node.type === "station" && node.data.radio === null
    );
    expect(slot?.position).toEqual({ x: -400, y: 320 });
    expect(
      store.state.graph?.edges.filter((edge) => edge.source === slot?.id)
    ).toEqual([
      expect.objectContaining({
        target: "speakers",
        targetHandle: "in:audio:main",
      }),
    ]);
  });
});
