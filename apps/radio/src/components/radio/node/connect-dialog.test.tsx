/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
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
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
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
let createNodeStore: typeof import("@/lib/node-graph/node-store")["createNodeStore"];
let buildNodeGraphFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeGraphFromTemplate"];

beforeAll(async () => {
  ({ ConnectDialog } = await import("./connect-dialog"));
  ({ createNodeStore } = await import("@/lib/node-graph/node-store"));
  ({ buildNodeGraphFromTemplate } = await import("@/lib/node-graph/templates"));
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
