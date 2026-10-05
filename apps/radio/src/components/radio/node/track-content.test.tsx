/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createNodeStore } from "@/lib/node-graph/node-store";
import { DEFAULT_MEDIA_STRIP } from "@/lib/node-graph/schema";
import type { NodeActions } from "./node-actions";

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

// The real discovery over offline directories: only saved stations match.
// Another suite replaces this module for the whole run, so pin it here.
const { createStationDiscovery } = await import(
  "@/lib/stations/station-discovery"
);
const offline = { search: async () => [] };
mock.module("@/lib/stations/station-discovery-adapters", () => ({
  createProductionStationDiscovery: () =>
    createStationDiscovery({
      radioBrowser: offline,
      radioGarden: offline,
      streamProbe: { prepare: async () => null },
    }),
}));

// React DOM checks for input events when it loads, so it loads after the DOM.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

let TrackNodeContent: typeof import("./track-content")["TrackNodeContent"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];

beforeAll(async () => {
  ({ TrackNodeContent } = await import("./track-content"));
  ({ NodeActionsProvider } = await import("./node-actions"));
});

const noop = () => undefined;
const asyncNoop = async () => undefined;
const LINK = "https://stream.example/live";
const TRACK_ID = "track-race";

type StreamCall = {
  isCurrent: () => boolean;
  finish: (failure: string | null) => void;
};

function renderBothViews() {
  const streamCalls: StreamCall[] = [];
  const actions: NodeActions = {
    fillSource: asyncNoop,
    fillStation: asyncNoop,
    fillStationFromUrl: (_nodeId, _url, isCurrent) =>
      new Promise<string | null>((finish) => {
        streamCalls.push({ finish, isCurrent: isCurrent ?? (() => true) });
      }),
    handleDeleteRadio: noop,
    handleEditRadio: noop,
    handleSaveSessionRadio: noop,
    handleToggleRadio: asyncNoop,
    inspectNode: noop,
    radios: [],
    removeNode: noop,
    revealNode: noop,
    saveDiscoveredStation: noop,
    selectDiscoveredForStation: noop,
    swapEffect: noop,
  };
  const data = {
    muted: false,
    radio: null,
    strip: DEFAULT_MEDIA_STRIP,
    volume: 1,
  };
  const store = createNodeStore();
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeActionsProvider value={actions}>
        <section aria-label="Patch">
          <TrackNodeContent data={data} id={TRACK_ID} store={store} />
        </section>
        <section aria-label="Inspector">
          <TrackNodeContent data={data} id={TRACK_ID} store={store} />
        </section>
      </NodeActionsProvider>
    </QueryClientProvider>
  );
  const [patch, inspector] = view.getAllByRole("region");
  if (!(patch && inspector)) {
    throw new Error("expected both views");
  }
  return { inspector, patch, streamCalls };
}

function pasteStreamLink(view: HTMLElement) {
  const field = view.querySelector<HTMLInputElement>('input[type="search"]');
  if (!field) {
    throw new Error("missing Track search");
  }
  fireEvent.focusIn(field);
  fireEvent.change(field, { target: { value: LINK } });
  fireEvent.submit(field.closest("form") as HTMLFormElement);
}

describe("TrackNodeContent", () => {
  test("a stream link submitted in one view yields to a newer action in the other", async () => {
    const { inspector, patch, streamCalls } = renderBothViews();

    pasteStreamLink(patch);
    const [stream] = streamCalls;
    expect(stream?.isCurrent()).toBe(true);

    // Choosing a platform in the inspector supersedes the patch's request.
    const soundCloud = Array.from(
      inspector.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent === "SoundCloud");
    if (!soundCloud) {
      throw new Error("missing SoundCloud chip");
    }
    fireEvent.click(soundCloud);
    expect(stream?.isCurrent()).toBe(false);

    await act(async () => {
      stream?.finish("Couldn't load that stream");
      await Promise.resolve();
    });
    expect(patch.querySelector('[role="alert"]')).toBeNull();
  });

  test("the latest stream link still reports why it failed", async () => {
    const { patch, streamCalls } = renderBothViews();

    pasteStreamLink(patch);
    await act(async () => {
      streamCalls[0]?.finish("Couldn't load that stream");
      await Promise.resolve();
    });
    expect(patch.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't load that stream"
    );
  });
});
