import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import type { Radio } from "@/lib/audio";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

type TrackLoadOptions = {
  onLoad: (radio: Radio) => void;
  onError?: (message: string, code: string) => void;
  onSettled?: () => void;
};

let trackLoadOptions: TrackLoadOptions | undefined;
const mutateMock = mock((_url: string) => undefined);
const searchResultsState = {
  error: null as string | null,
  results: [
    {
      id: "track-1",
      url: "https://youtube.com/watch?v=track-1",
      title: "Track One",
      artist: "DJ Test",
      duration: 95,
      platform: "youtube" as const,
      type: "track" as const,
      thumbnail: null,
    },
  ],
};

mock.module("@avoid.quest/ui/components/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

mock.module("@/lib/hooks/use-dj-track-load", () => ({
  useDjTrackLoad: (options: TrackLoadOptions) => {
    trackLoadOptions = options;
    return {
      mutate: mutateMock,
      isPending: false,
    };
  },
}));

mock.module("./search-results-store", () => ({
  useSearchResultsStore: <T,>(
    selector: (state: typeof searchResultsState) => T
  ) => selector(searchResultsState),
}));

let SearchResults: typeof import("./search-results")["SearchResults"];

beforeAll(async () => {
  ({ SearchResults } = await import("./search-results"));
});

beforeEach(() => {
  trackLoadOptions = undefined;
  mutateMock.mockClear();
  searchResultsState.error = null;
});

afterEach(() => {
  cleanup();
});

describe("SearchResults", () => {
  test("shows track-load failures inline for result selections", () => {
    const view = render(<SearchResults onLoad={() => undefined} />);

    fireEvent.click(view.getByRole("button"));

    expect(mutateMock).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=track-1"
    );

    act(() => {
      trackLoadOptions?.onError?.(
        "Playlist unavailable",
        "DJ_TRACK_RESOLUTION_FAILED"
      );
    });

    expect(view.getByText("Playlist unavailable")).toBeTruthy();
  });
});
