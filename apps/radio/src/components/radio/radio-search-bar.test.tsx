/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import type {
  StationDirectoryAdapter,
  StationDiscoveryCandidate,
} from "@/lib/stations/station-discovery";
import { browserTestGlobals } from "@/test-utils/browser-globals";

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
  ...browserTestGlobals(dom.window),
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
let browserSearch: StationDirectoryAdapter["search"] = offline.search;
let gardenSearch: StationDirectoryAdapter["search"] = offline.search;
beforeEach(() => {
  browserSearch = offline.search;
  gardenSearch = offline.search;
});
mock.module("@/lib/stations/station-discovery-adapters", () => ({
  createProductionStationDiscovery: () =>
    createStationDiscovery({
      radioBrowser: {
        search: (query, options) => browserSearch(query, options),
      },
      radioGarden: { search: (query, options) => gardenSearch(query, options) },
      streamProbe: { prepare: async (candidate) => candidate },
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
  onSelectDiscovered = noop,
  onSaveDiscovered,
  radios = [kexp],
  onSubmitUrl,
}: {
  onSelectLocal?: (radio: Radio) => void;
  onSelectDiscovered?: (radio: Radio) => void;
  onSaveDiscovered?: (radio: Radio) => void;
  radios?: Radio[];
  onSubmitUrl?: (url: string, signal: AbortSignal) => Promise<string | null>;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RadioSearchBar
        onSaveDiscovered={onSaveDiscovered}
        onSelectDiscovered={onSelectDiscovered}
        onSelectLocal={onSelectLocal}
        onSubmitUrl={onSubmitUrl}
        radios={radios}
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

  test("unmounting aborts a link still loading", async () => {
    const load = deferred<string | null>();
    let signal: AbortSignal | null = null;
    const { search, type, view } = renderSearch({
      onSubmitUrl: (_url, next) => {
        signal = next;
        return load.promise;
      },
    });

    type(LINK);
    fireEvent.keyDown(search, { key: "Enter" });
    expect((signal as AbortSignal | null)?.aborted).toBe(false);
    view.unmount();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await act(async () => {
      load.resolve(null);
      await load.promise;
    });
  });

  test("a long tokenized link fits in the search", () => {
    const { search } = renderSearch({ onSubmitUrl: async () => null });

    // Signed HLS and share links run past 200 characters; the browser would
    // silently cut the paste at maxLength.
    expect(search.maxLength).toBeGreaterThanOrEqual(2048);
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

function directoryCandidate(
  source: StationDiscoveryCandidate["source"],
  name: string
): StationDiscoveryCandidate {
  return {
    key: `${source}:${name}`,
    radio: { name, streamUrl: `https://radio.example/${name}` },
    source,
  };
}

test("IME Enter and legacy composition keycodes preserve the query without playing", async () => {
  const onSelectLocal = mock(noop);
  const { search, type } = renderSearch({ onSelectLocal });
  type("KEXP");
  await waitFor(() =>
    expect(search.getAttribute("aria-activedescendant")).toBeTruthy()
  );
  fireEvent.keyDown(search, { isComposing: true, key: "Enter" });
  fireEvent.keyDown(search, { key: "Enter", keyCode: 229 });
  expect(onSelectLocal).not.toHaveBeenCalled();
  expect(search.value).toBe("KEXP");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onSelectLocal).toHaveBeenCalledWith(kexp);
});

test("a late directory result preserves the keyboard-selected station identity", async () => {
  const browser = deferred<StationDiscoveryCandidate[]>();
  const garden = directoryCandidate("radio-garden", "Radio Garden");
  browserSearch = () => browser.promise;
  gardenSearch = async () => [garden];
  const onSelectDiscovered = mock(noop);
  const { search, type, view } = renderSearch({
    onSelectDiscovered,
    radios: [],
  });
  type("radio");
  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Listen to Radio Garden" })
    ).toBeTruthy()
  );
  await act(() => {
    browser.resolve([directoryCandidate("radio-browser", "Radio Browser")]);
  });
  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Listen to Radio Browser" })
    ).toBeTruthy()
  );
  expect(
    document.getElementById(search.getAttribute("aria-activedescendant") ?? "")
      ?.textContent
  ).toContain("Radio Garden");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onSelectDiscovered).toHaveBeenCalledWith(garden.radio);
});

test("mouse selection restores input focus and touch selection avoids opening the keyboard", async () => {
  const { search, type, view } = renderSearch({});
  type("KEXP");
  const button = await waitFor(() =>
    view.getByRole("button", { name: "Listen to KEXP" })
  );
  button.focus();
  fireEvent.click(button);
  expect(document.activeElement).toBe(search);
  type("KEXP");
  const touchButton = await waitFor(() =>
    view.getByRole("button", { name: "Listen to KEXP" })
  );
  const pointer = new dom.window.Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointer, "pointerType", { value: "touch" });
  fireEvent(touchButton, pointer);
  touchButton.focus();
  fireEvent.click(touchButton);
  expect(document.activeElement).not.toBe(search);
});

test("Save is a keyboard-focusable grid action outside any listbox option", async () => {
  const station = directoryCandidate("radio-browser", "Radio Test");
  browserSearch = async () => [station];
  const save = mock(noop);
  const { search, type, view } = renderSearch({
    onSaveDiscovered: save,
    radios: [],
  });
  type("radio");
  const button = await waitFor(() =>
    view.getByRole("button", { name: "Save Radio Test to collection" })
  );
  expect(search.getAttribute("aria-haspopup")).toBe("grid");
  expect(button.closest('[role="option"]')).toBeNull();
  expect(button.closest('[role="grid"]')).toBeTruthy();
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledWith(station.radio);
  expect(search.value).toBe("radio");
});

test("closing search aborts pending directory requests", async () => {
  let signal: AbortSignal | undefined;
  browserSearch = (_query, options) => {
    ({ signal } = options);
    return new Promise(() => undefined);
  };
  const { type, view } = renderSearch({});
  type("radio");
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.mouseDown(document.body);
  expect(signal?.aborted).toBe(true);
  expect(view.queryByRole("grid")).toBeNull();
});

test("directory failures preserve local matches, offer retry, and successful empty searches stay empty", async () => {
  browserSearch = () => Promise.reject(new Error("offline"));
  const { search, type, view } = renderSearch({});
  type("KEXP");
  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Retry station search" })
    ).toBeTruthy()
  );
  expect(view.getByRole("button", { name: "Listen to KEXP" })).toBeTruthy();
  expect(view.getByText("Couldn’t reach the station directory.")).toBeTruthy();
  browserSearch = offline.search;
  fireEvent.click(view.getByRole("button", { name: "Retry station search" }));
  await waitFor(() =>
    expect(
      view.queryByRole("button", { name: "Retry station search" })
    ).toBeNull()
  );
  type("nothing");
  await waitFor(() =>
    expect(
      view.getByText("No stations found", { selector: "div" })
    ).toBeTruthy()
  );
  expect(search.value).toBe("nothing");
});
