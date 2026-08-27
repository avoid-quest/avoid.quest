import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { PLATFORM_ITEMS } from "@/lib/dj-library-sources";
import { resetDefaultPlaybackActionContext } from "@/lib/playback-action-context";
import { useDeckAState } from "./use-deck-state";

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

let latestLoad: ReturnType<typeof useDeckAState>["loadSource"];
let latestCancelPendingSource: ReturnType<
  typeof useDeckAState
>["cancelPendingSource"];
let latestPendingPlatform: ReturnType<typeof useDeckAState>["pendingPlatform"];

function Harness({ revision: _revision }: { revision: number }) {
  const state = useDeckAState();
  latestLoad = state.loadSource;
  latestCancelPendingSource = state.cancelPendingSource;
  latestPendingPlatform = state.pendingPlatform;
  return null;
}

afterEach(() => {
  cleanup();
  resetDefaultPlaybackActionContext();
});

test("resolves a new Deck handle after the default playback context resets", () => {
  const view = render(<Harness revision={0} />);
  const firstContextLoad = latestLoad;

  view.rerender(<Harness revision={1} />);
  expect(latestLoad).toBe(firstContextLoad);

  resetDefaultPlaybackActionContext();
  view.rerender(<Harness revision={2} />);

  expect(latestLoad).not.toBe(firstContextLoad);
});

test("observes and cancels a pending platform source through the Deck adapter", async () => {
  render(<Harness revision={0} />);
  const [pendingItem] = PLATFORM_ITEMS;
  if (!pendingItem) {
    throw new Error("Expected a platform picker library item");
  }

  await act(async () => {
    await latestLoad({ radio: pendingItem, type: "library" });
  });

  expect(latestPendingPlatform).toBe("external");

  act(() => latestCancelPendingSource());

  expect(latestPendingPlatform).toBeUndefined();
});
