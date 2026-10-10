import { afterEach, beforeAll, expect, mock, spyOn, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const searchHook = await import("@/lib/hooks/use-external-search");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
let SearchInput: typeof import("./search-input")["SearchInput"];
for (const [key, value] of Object.entries({
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  navigator: dom.window.navigator,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
const { cleanup, fireEvent, render } = await import("@testing-library/react");
beforeAll(async () => {
  ({ SearchInput } = await import("./search-input"));
});
afterEach(() => {
  cleanup();
  mock.restore();
});

test("submitting a pending search again does not launch another request", () => {
  const search = mock(() => undefined);
  const reset = mock(() => undefined);
  let pending = false;
  spyOn(searchHook, "useExternalSearch").mockImplementation(
    () =>
      ({
        isPending: pending,
        mutate: search,
        reset,
      }) as unknown as ReturnType<typeof searchHook.useExternalSearch>
  );
  const props = {
    bandcampFilter: "" as const,
    onBandcampFilterChange: mock(() => undefined),
    onClearResults: mock(() => undefined),
    onError: mock(() => undefined),
    onPlatformChange: mock(() => undefined),
    onResults: mock(() => undefined),
    onYoutubeFilterChange: mock(() => undefined),
    platform: "soundcloud" as const,
    searchContextKey: "test",
    showPlatform: false,
    youtubeFilter: "songs" as const,
  };
  const view = render(<SearchInput {...props} />);
  const input = view.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "ambient" } });
  const form = input.closest("form");
  if (!form) {
    throw new Error("Expected search form");
  }
  fireEvent.submit(form);
  expect(search).toHaveBeenCalledTimes(1);
  pending = true;
  view.rerender(<SearchInput {...props} />);
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(search).toHaveBeenCalledTimes(1);
});

test("editing a query invalidates late results, progress and errors from the previous search", () => {
  const search = mock(() => undefined);
  spyOn(searchHook, "useExternalSearch").mockReturnValue({
    isPending: false,
    mutate: search,
    reset: mock(() => undefined),
  } as unknown as ReturnType<typeof searchHook.useExternalSearch>);
  const noop = () => undefined;
  const onResults = mock(() => undefined);
  const onError = mock(() => undefined);
  const view = render(
    <SearchInput
      bandcampFilter="t"
      onBandcampFilterChange={noop}
      onClearResults={noop}
      onError={onError}
      onPlatformChange={noop}
      onResults={onResults}
      onYoutubeFilterChange={noop}
      platform="all"
      searchContextKey="all"
      showPlatform={false}
      youtubeFilter="songs"
    />
  );
  const input = view.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "old" } });
  const form = input.closest("form");
  if (!form) {
    throw new Error("Missing form");
  }
  fireEvent.submit(form);
  const [params, callbacks] = search.mock.calls[0] as unknown as [
    { onProgress: (results: []) => void },
    { onSuccess: (results: []) => void; onError: (error: Error) => void },
  ];
  fireEvent.change(input, { target: { value: "new" } });
  params.onProgress([]);
  callbacks.onSuccess([]);
  callbacks.onError(new Error("late error"));
  expect(onResults).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
