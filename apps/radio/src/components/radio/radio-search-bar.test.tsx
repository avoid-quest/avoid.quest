/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

let RadioSearchBar: typeof import("./radio-search-bar")["RadioSearchBar"];

beforeAll(async () => {
  ({ RadioSearchBar } = await import("./radio-search-bar"));
});

const kexp: Radio = {
  enabled: true,
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://radio.example/kexp.mp3",
};
const noop = () => undefined;
const LINK = "https://stream.example/live";

function deferred<T>() {
  let resolve: (value: T) => void = noop;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderSearch({
  onSelectLocal = noop,
  onSubmitUrl,
}: {
  onSelectLocal?: (radio: Radio) => void;
  onSubmitUrl: (url: string, signal: AbortSignal) => Promise<string | null>;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RadioSearchBar
        onSelectDiscovered={noop}
        onSelectLocal={onSelectLocal}
        onSubmitUrl={onSubmitUrl}
        radios={[kexp]}
      />
    </QueryClientProvider>
  );
  const search = view.getByRole("combobox", {
    name: "Search stations",
  }) as HTMLInputElement;
  // React DOM may have loaded before any DOM in a full run, in which case
  // it watches focus and key events for input instead of change events.
  const type = (value: string) => {
    fireEvent.focusIn(search);
    fireEvent.change(search, { target: { value } });
    fireEvent.keyUp(search, { key: value.at(-1) ?? "" });
  };
  return { search, type, view };
}

describe("RadioSearchBar pasted links", () => {
  test("a newer query aborts the pending link and ignores its outcome", async () => {
    const load = deferred<string | null>();
    let signal: AbortSignal | null = null;
    const onSubmitUrl = mock((_url: string, next: AbortSignal) => {
      signal = next;
      return load.promise;
    });
    const { search, type, view } = renderSearch({ onSubmitUrl });

    type(LINK);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSubmitUrl).toHaveBeenCalledWith(LINK, expect.anything());
    expect((signal as AbortSignal | null)?.aborted).toBe(false);

    type("KEX");
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await act(async () => {
      load.resolve("Couldn't load that link");
      await load.promise;
    });

    // The stale failure is not shown, and the new query stays.
    expect(view.queryByRole("alert")).toBeNull();
    expect(search.value).toBe("KEX");
  });

  test("searching again to pick a result aborts a link still loading", async () => {
    const load = deferred<string | null>();
    let signal: AbortSignal | null = null;
    const onSelectLocal = mock((_radio: Radio) => undefined);
    const { search, type, view } = renderSearch({
      onSelectLocal,
      onSubmitUrl: (_url, next) => {
        signal = next;
        return load.promise;
      },
    });

    type(LINK);
    fireEvent.keyDown(search, { key: "Enter" });
    type("KEXP");
    fireEvent.click(
      await waitFor(() => view.getByRole("button", { name: "Listen to KEXP" }))
    );

    expect(onSelectLocal).toHaveBeenCalledWith(kexp);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await act(async () => {
      load.resolve(null);
      await load.promise;
    });
  });

  test("a link that loads clears the search", async () => {
    const { search, type } = renderSearch({ onSubmitUrl: async () => null });

    type(LINK);
    await act(async () => {
      fireEvent.keyDown(search, { key: "Enter" });
      await Promise.resolve();
    });

    expect(search.value).toBe("");
  });
});
