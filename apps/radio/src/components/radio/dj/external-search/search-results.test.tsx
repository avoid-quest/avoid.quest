import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import type { Radio } from "@/lib/audio";
import type { LoadPlatformItemResult } from "@/lib/platform-item-loader";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  navigator: dom.window.navigator,
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

const handleLoad = () => undefined;
const SEARCH_RESULTS: UnifiedSearchResult[] = [
  {
    artist: "DJ Test",
    duration: 95,
    id: "track-1",
    platform: "youtube",
    title: "Track One",
    type: "track",
    url: "https://youtube.com/watch?v=track-1",
  },
];
const NEXT_RESULT: UnifiedSearchResult = {
  artist: "DJ Next",
  id: "track-2",
  platform: "soundcloud",
  title: "Track Two",
  type: "track",
  url: "https://soundcloud.com/artist/track-2",
};
const ABANDONED_RADIO: Radio = {
  name: "Abandoned track",
  streamUrl: "https://audio.example/abandoned.mp3",
};
const NEXT_RADIO: Radio = {
  name: "Next track",
  streamUrl: "https://audio.example/next.mp3",
};
const ABANDONED_PICK_CONTEXTS = [
  {
    error: null,
    name: "starting another search",
    nextResults: SEARCH_RESULTS,
    results: [],
  },
  {
    error: null,
    name: "replacing platform results",
    nextResults: [NEXT_RESULT],
    results: [NEXT_RESULT],
  },
  {
    error: "Search unavailable",
    name: "a search failure",
    nextResults: [NEXT_RESULT],
    results: SEARCH_RESULTS,
  },
];

function deferredLoad() {
  let resolve = (_value: LoadPlatformItemResult): void => undefined;
  const promise = new Promise<LoadPlatformItemResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let queryClient: QueryClient;
let platformItemLoader: typeof import("@/lib/platform-item-loader");
let djErrorSurface: typeof import("@/lib/dj/dj-error-surface");
let loadPlatformItemMock: ReturnType<
  typeof spyOn<typeof platformItemLoader, "loadPlatformItem">
>;
let captureDjErrorMock: ReturnType<
  typeof spyOn<typeof djErrorSurface, "captureDjError">
>;

function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

mock.module("@avoid.quest/ui/components/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

let SearchResults: typeof import("./search-results")["SearchResults"];

beforeAll(async () => {
  [platformItemLoader, djErrorSurface] = await Promise.all([
    import("@/lib/platform-item-loader"),
    import("@/lib/dj/dj-error-surface"),
  ]);
  ({ SearchResults } = await import("./search-results"));
});

beforeEach(() => {
  queryClient = new QueryClient();
  loadPlatformItemMock = spyOn(platformItemLoader, "loadPlatformItem");
  captureDjErrorMock = spyOn(
    djErrorSurface,
    "captureDjError"
  ).mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  loadPlatformItemMock.mockRestore();
  captureDjErrorMock.mockRestore();
});

describe("SearchResults", () => {
  test("shows track-load failures inline for result selections", async () => {
    loadPlatformItemMock.mockResolvedValue({
      code: "DJ_TRACK_RESOLUTION_FAILED",
      error: "Playlist unavailable",
      success: false,
    });
    const view = render(
      <SearchResults
        error={null}
        onLoad={handleLoad}
        results={SEARCH_RESULTS}
      />,
      { wrapper: QueryProvider }
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button"));
      await Promise.resolve();
    });

    expect(loadPlatformItemMock.mock.calls[0]?.[0]).toBe(
      "https://youtube.com/watch?v=track-1"
    );

    await waitFor(() => {
      expect(view.getByText("Playlist unavailable")).toBeTruthy();
    });
    expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(captureDjErrorMock).toHaveBeenCalledWith(
      "Playlist unavailable",
      "DJ_TRACK_RESOLUTION_FAILED"
    );
  });

  test.each(ABANDONED_PICK_CONTEXTS)(
    "unlocks results after $name abandons a pending pick",
    async (context) => {
      const abandoned = deferredLoad();
      const next = deferredLoad();
      loadPlatformItemMock
        .mockImplementationOnce(() => abandoned.promise)
        .mockImplementationOnce(() => next.promise);
      const onLoad = mock((_radio: Radio) => undefined);
      const view = render(
        <SearchResults error={null} onLoad={onLoad} results={SEARCH_RESULTS} />,
        { wrapper: QueryProvider }
      );

      await act(async () => {
        fireEvent.click(view.getByRole("button"));
        await Promise.resolve();
      });
      expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
        true
      );

      view.rerender(
        <SearchResults
          error={context.error}
          onLoad={onLoad}
          results={context.results}
        />
      );
      view.rerender(
        <SearchResults
          error={null}
          onLoad={onLoad}
          results={context.nextResults}
        />
      );
      expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
        false
      );

      await act(async () => {
        fireEvent.click(view.getByRole("button"));
        await Promise.resolve();
      });
      expect(loadPlatformItemMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        abandoned.resolve({ radio: ABANDONED_RADIO, success: true });
        await abandoned.promise;
      });
      await waitFor(() => {
        expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
          "success"
        );
      });
      expect(onLoad).not.toHaveBeenCalled();
      expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
        true
      );

      await act(async () => {
        next.resolve({ radio: NEXT_RADIO, success: true });
        await next.promise;
      });
      await waitFor(() => {
        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(onLoad).toHaveBeenCalledWith(NEXT_RADIO);
      });
      expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
        false
      );
    }
  );
});
