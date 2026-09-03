import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import type { Radio } from "@/lib/audio";

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

type TrackLoadOptions = {
  onLoad: (radio: Radio) => void;
  onError?: (message: string, code: string) => void;
  onSettled?: () => void;
};

let trackLoadOptions: TrackLoadOptions | undefined;
const mutateMock = mock((_url: string) => undefined);
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
      isPending: false,
      mutate: mutateMock,
    };
  },
}));

let SearchResults: typeof import("./search-results")["SearchResults"];

beforeAll(async () => {
  ({ SearchResults } = await import("./search-results"));
});

beforeEach(() => {
  trackLoadOptions = undefined;
  mutateMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SearchResults", () => {
  test("shows track-load failures inline for result selections", () => {
    const view = render(
      <SearchResults
        error={null}
        onLoad={handleLoad}
        results={SEARCH_RESULTS}
      />
    );

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
