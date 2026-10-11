import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import type { SourceLoad } from "@/lib/node-source-loaders";
import type { SourceSearchResult } from "@/lib/source-search-workflow";
import {
  createStationIntake,
  stationIntake,
} from "@/lib/stations/external-station-workflow";

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

const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { SourceSearchPopover } = await import("./source-search-popover");
const { ExternalSearch } = await import("../dj/external-search");
const searchHook = await import("@/lib/hooks/use-external-search");
const loaders = await import("@/lib/node-source-loaders");
afterEach(() => {
  cleanup();
  mock.restore();
});
const GARDEN_RESULT = /Garden/;
const station: Radio = {
  id: "directory",
  name: "Garden",
  streamUrl: "https://stream.example/live",
};
const results: SourceSearchResult[] = [
  {
    artist: "",
    id: "garden",
    platform: "radio-browser",
    radio: station,
    title: "Garden",
    type: "station",
    url: station.streamUrl,
  },
];

function searchStub() {
  const reset = mock(() => undefined);
  const mutate = mock(
    (
      _params: unknown,
      callbacks: { onSuccess: (items: SourceSearchResult[]) => void }
    ) => callbacks.onSuccess(results)
  );
  spyOn(searchHook, "useExternalSearch").mockReturnValue({
    isPending: false,
    mutate,
    reset,
  } as unknown as ReturnType<typeof searchHook.useExternalSearch>);
}
function submit(view: ReturnType<typeof render>, query: string) {
  const input = view.getByRole("searchbox");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}
function openSearch(
  onLoad = mock(async (_radio: Radio): Promise<void> => undefined)
) {
  searchStub();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceSearchPopover onLoad={onLoad} radios={[]} />
    </QueryClientProvider>
  );
  fireEvent.click(view.getByRole("button", { name: "Search sources" }));
  submit(view, "garden");
  fireEvent.click(view.getByRole("button", { name: GARDEN_RESULT }));
  return { onLoad, view };
}

for (const cancellation of ["query", "close", "unmount"] as const) {
  test(`a ${cancellation} cancels a pending toolbar pick before it can load`, async () => {
    const pending = Promise.withResolvers<SourceLoad>();
    const load = spyOn(loaders, "loadSearchSource").mockImplementation(
      () => pending.promise
    );
    const { view, onLoad } = openSearch();
    expect(load).toHaveBeenCalledTimes(1);
    if (cancellation === "query") {
      fireEvent.change(view.getByRole("searchbox"), {
        target: { value: "new" },
      });
    }
    if (cancellation === "close") {
      fireEvent.click(view.getByRole("button", { name: "Search sources" }));
    }
    if (cancellation === "unmount") {
      view.unmount();
    }
    await act(async () => {
      pending.resolve({ radio: station });
      await pending.promise;
    });
    expect(onLoad).not.toHaveBeenCalled();
  });
}

test("a stale toolbar failure cannot replace the newer search", async () => {
  const pending = Promise.withResolvers<SourceLoad>();
  spyOn(loaders, "loadSearchSource").mockImplementation(() => pending.promise);
  const { view } = openSearch();
  fireEvent.change(view.getByRole("searchbox"), { target: { value: "new" } });
  await act(async () => {
    pending.resolve({ error: "Old pick failed" });
    await pending.promise;
  });
  expect(view.queryByText("Old pick failed")).toBeNull();
});

test("an old load completion cannot close a reopened toolbar search", async () => {
  const pending = Promise.withResolvers<void>();
  spyOn(loaders, "loadSearchSource").mockResolvedValue({ radio: station });
  const onLoad = mock(async (_radio: Radio) => pending.promise);
  const { view } = openSearch(onLoad);
  await act(async () => {
    await Promise.resolve();
  });
  expect(onLoad).toHaveBeenCalledTimes(1);
  const trigger = view.getByRole("button", { name: "Search sources" });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  expect(view.queryByRole("searchbox")).not.toBeNull();
});

test("a newer selection owns the toolbar error even if the older load rejects later", async () => {
  const first = Promise.withResolvers<SourceLoad>();
  const second = Promise.withResolvers<SourceLoad>();
  spyOn(loaders, "loadSearchSource")
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const { view, onLoad } = openSearch();
  fireEvent.click(view.getByRole("button", { name: GARDEN_RESULT }));
  await act(async () => {
    second.resolve({ error: "Current pick failed" });
    await second.promise;
  });
  expect(view.queryByText("Current pick failed")).not.toBeNull();
  await act(async () => {
    first.reject(new Error("Old pick rejected"));
    await Promise.resolve();
  });
  expect(view.queryByText("Old pick rejected")).toBeNull();
  expect(view.queryByText("Current pick failed")).not.toBeNull();
  expect(onLoad).not.toHaveBeenCalled();
});

for (const cancellation of ["query", "unmount"] as const) {
  test(`a direct stream canceled by ${cancellation} never enters the session collection`, async () => {
    const add = mock(() => undefined);
    const remove = mock(() => undefined);
    const intake = createStationIntake({
      adapters: {},
      saved: { add: () => "unused", getAll: () => [], update: () => undefined },
      session: { add, getAll: () => [], remove },
    });
    const create = spyOn(stationIntake, "createSession").mockImplementation(
      intake.createSession
    );
    const onLoad = mock(() => undefined);
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <ExternalSearch onLoad={onLoad} />
      </QueryClientProvider>
    );
    submit(view, "https://stream.example/live");
    expect(create).toHaveBeenCalledTimes(1);
    if (cancellation === "query") {
      fireEvent.change(view.getByRole("searchbox"), {
        target: { value: "new" },
      });
    } else {
      view.unmount();
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();
  });
}
