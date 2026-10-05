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
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

let NodeToolbar: typeof import("./node-toolbar")["NodeToolbar"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let templates: typeof import("@/lib/node-graph/templates");
let templatePatch: typeof import("@/lib/node-graph/palette")["templatePatch"];

beforeAll(async () => {
  ({ NodeToolbar } = await import("./node-toolbar"));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  templates = await import("@/lib/node-graph/templates");
  ({ templatePatch } = await import("@/lib/node-graph/palette"));
});

const kexp = {
  enabled: true,
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://radio.example/kexp.mp3",
};

function openTemplates(view: ReturnType<typeof render>) {
  act(() => {
    fireEvent.keyDown(view.getByRole("button", { name: "Templates" }), {
      key: "Enter",
    });
  });
}

describe("NodeToolbar templates", () => {
  test("phone actions fit the canvas and keep templates and undo/redo reachable", () => {
    const { commitNodeGraph, createNodeStore } = nodeStoreModule;
    const before = templates.buildNodeGraphFromTemplate("duck", {
      saved: [kexp],
    });
    const store = createNodeStore(before);
    const onAdd = mock(() => undefined);
    const onFitView = mock(() => undefined);
    const view = render(
      <NodeToolbar
        isPhone
        onAdd={onAdd}
        onFitView={onFitView}
        onLoadTemplate={(template) =>
          commitNodeGraph(
            (current) => templatePatch(current, template, { saved: [kexp] }),
            store,
            "snapshot"
          )
        }
        store={store}
      />
    );
    const openActions = () => {
      act(() => {
        fireEvent.keyDown(view.getByRole("button", { name: "Patch actions" }), {
          key: "Enter",
        });
      });
    };

    fireEvent.click(view.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    openActions();
    fireEvent.click(view.getByRole("menuitem", { name: "Fit view" }));
    expect(onFitView).toHaveBeenCalledTimes(1);
    openActions();
    expect(
      view.getByRole("menuitem", { name: "Undo" }).hasAttribute("data-disabled")
    ).toBe(true);
    expect(
      view.getByRole("menuitem", { name: "Redo" }).hasAttribute("data-disabled")
    ).toBe(true);
    fireEvent.click(view.getByRole("menuitem", { name: "BlankSpeakers only" }));
    const blank = store.state.graph;
    expect(blank?.nodes).toEqual(
      templates.buildNodeGraphFromTemplate("blank").nodes
    );

    openActions();
    fireEvent.click(view.getByRole("menuitem", { name: "Undo" }));
    expect(store.state.graph).toEqual(before);

    openActions();
    fireEvent.click(view.getByRole("menuitem", { name: "Redo" }));
    expect(store.state.graph).toEqual(blank);
  });

  test("lists Starter, All my stations, Duck and Blank; each replaces the patch as one undo step", () => {
    const { commitNodeGraph, createNodeStore, undoNodeGraph } = nodeStoreModule;
    const before = templates.buildNodeGraphFromTemplate("duck", {
      saved: [kexp],
    });
    const store = createNodeStore(before);
    const onLoadTemplate = mock(
      (template: import("@/lib/node-graph/templates").NodeTemplateId) => {
        commitNodeGraph(
          (current) => templatePatch(current, template, { saved: [kexp] }),
          store,
          "snapshot"
        );
      }
    );
    const view = render(
      <NodeToolbar
        onAdd={() => undefined}
        onLoadTemplate={onLoadTemplate}
        store={store}
      />
    );

    openTemplates(view);
    const names = view
      .getAllByRole("menuitem")
      .map((item) => item.querySelector("span")?.textContent);
    expect(names).toEqual(["Starter", "All my stations", "Duck", "Blank"]);

    for (const [index, template] of (
      ["starter", "start-from-multiple", "duck", "blank"] as const
    ).entries()) {
      if (index > 0) {
        openTemplates(view);
      }
      act(() => {
        fireEvent.click(view.getAllByRole("menuitem")[index] as HTMLElement);
      });

      expect(onLoadTemplate).toHaveBeenLastCalledWith(template);
      expect(store.state.graph?.nodes).toEqual(
        templates.buildNodeGraphFromTemplate(template, { saved: [kexp] }).nodes
      );
      act(() => {
        undoNodeGraph(store);
      });
      expect(store.state.graph).toEqual(before);
    }
  });
});
