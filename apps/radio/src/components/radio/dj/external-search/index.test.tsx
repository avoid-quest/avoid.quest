import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
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

mock.module("./search-input", () => ({
  SearchInput: ({
    onResults,
    platform,
  }: {
    onResults: (results: UnifiedSearchResult[]) => void;
    platform: SearchPlatform;
  }) => (
    <button
      onClick={() =>
        onResults([
          {
            artist: "Artist",
            id: "bc-1",
            platform: "bandcamp",
            title: "Bandcamp result",
            type: "track",
            url: "https://artist.bandcamp.com/track/example",
          },
        ])
      }
      type="button"
    >
      {platform}
    </button>
  ),
}));

mock.module("./search-results", () => ({
  SearchResults: ({ results }: { results: UnifiedSearchResult[] }) => (
    <div>results:{results.length}</div>
  ),
}));

mock.module("./url-input", () => ({
  UrlInput: () => <div>url</div>,
}));

let ExternalSearch: typeof import("./index")["ExternalSearch"];

beforeAll(async () => {
  ({ ExternalSearch } = await import("./index"));
});

afterEach(() => {
  cleanup();
});

describe("ExternalSearch", () => {
  test("resets provider state and stale results when its locked provider changes", async () => {
    const onLoad = (_radio: Radio) => undefined;
    const view = render(
      <ExternalSearch initialPlatform="bandcamp" onLoad={onLoad} />
    );
    fireEvent.click(view.getByRole("button"));
    expect(view.getByText("results:1")).toBeTruthy();

    view.rerender(
      <ExternalSearch initialPlatform="soundcloud" onLoad={onLoad} />
    );

    await waitFor(() => {
      expect(view.getByText("results:0")).toBeTruthy();
      expect(view.getByText("soundcloud")).toBeTruthy();
    });
  });
});
