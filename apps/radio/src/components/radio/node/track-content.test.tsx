/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createNodeStore } from "@/lib/node-graph/node-store";
import { DEFAULT_MEDIA_STRIP, nodeGraphSchema } from "@/lib/node-graph/schema";
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
  Event: dom.window.Event,
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
  const store = createNodeStore(
    nodeGraphSchema.parse({
      edges: [],
      nodes: [
        { data, id: TRACK_ID, position: { x: 0, y: 0 }, type: "platform" },
        {
          data: {},
          id: "speakers",
          position: { x: 0, y: 200 },
          type: "speakers",
        },
      ],
      version: 2,
    })
  );
  function TrackView({ embedded = false }: { embedded?: boolean }) {
    const track = useStore(store, (state) => state.graph?.nodes[0]);
    if (track?.type !== "platform") {
      throw new Error("Missing Track");
    }
    return (
      <TrackNodeContent
        data={track.data}
        id={TRACK_ID}
        showStrip={!embedded}
        store={store}
      />
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeActionsProvider value={actions}>
        <section aria-label="Patch">
          <TrackView />
        </section>
        <section aria-label="Inspector">
          <TrackView embedded />
        </section>
      </NodeActionsProvider>
    </QueryClientProvider>
  );
  const [patch, inspector] = view.getAllByRole("region");
  if (!(patch && inspector)) {
    throw new Error("expected both views");
  }
  return { actions, client, inspector, patch, store, streamCalls, view };
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
    const select = inspector.querySelector("select") as HTMLElement | null;
    if (!select) {
      throw new Error("missing source selector");
    }
    fireEvent.change(select, { target: { value: "soundcloud" } });
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

test("a platform link pending in one view cannot report a stale failure after the other view starts searching", async () => {
  const loader = await import("@/lib/platform-item-loader");
  let finish: (result: {
    success: false;
    error: string;
    code: string;
  }) => void = () => undefined;
  const pending = new Promise<{ success: false; error: string; code: string }>(
    (resolve) => {
      finish = resolve;
    }
  );
  const load = spyOn(loader, "loadPlatformItem").mockImplementation(
    () => pending
  );
  try {
    const { patch, inspector } = renderBothViews();
    const input = patch.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement;
    const other = inspector.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://youtube.com/watch?v=old" },
    });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.change(other, { target: { value: "new search" } });
    await act(async () => {
      finish({ code: "LOAD_FAILED", error: "Old link failed", success: false });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(patch.textContent).not.toContain("Old link failed");
  } finally {
    load.mockRestore();
  }
});

for (const provider of ["radio-browser", "radiogarden", "local"]) {
  test(`Track ${provider} filter syncs both views and survives stored remount`, () => {
    const { patch, inspector, store, view, client, actions } =
      renderBothViews();
    const select = inspector.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: provider } });
    expect(store.state.graph?.nodes[0]?.data).toMatchObject({
      searchPlatform: provider,
    });
    expect((patch.querySelector("select") as HTMLSelectElement).value).toBe(
      provider
    );
    expect((inspector.querySelector("select") as HTMLSelectElement).value).toBe(
      provider
    );
    fireEvent.change(patch.querySelector("select") as HTMLSelectElement, {
      target: { value: "all" },
    });
    expect((inspector.querySelector("select") as HTMLSelectElement).value).toBe(
      "all"
    );
    expect(store.state.graph?.nodes[0]?.data).toMatchObject({
      searchPlatform: undefined,
    });
    fireEvent.change(patch.querySelector("select") as HTMLSelectElement, {
      target: { value: provider },
    });
    expect((inspector.querySelector("select") as HTMLSelectElement).value).toBe(
      provider
    );
    const saved = nodeGraphSchema.parse(
      JSON.parse(JSON.stringify(store.state.graph))
    );
    const [track] = saved.nodes;
    if (track?.type !== "platform") {
      throw new Error("Missing saved Track");
    }
    view.unmount();
    const reopened = render(
      <QueryClientProvider client={client}>
        <NodeActionsProvider value={actions}>
          <TrackNodeContent
            data={track.data}
            id={TRACK_ID}
            store={createNodeStore(saved)}
          />
        </NodeActionsProvider>
      </QueryClientProvider>
    );
    expect(
      (reopened.container.querySelector("select") as HTMLSelectElement).value
    ).toBe(provider);
  });
}
