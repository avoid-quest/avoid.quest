import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { resetDefaultPlaybackActionContext } from "@/lib/playback-action-context";
import { useDeckAState } from "./use-deck-state";

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

let latestLoad: ReturnType<typeof useDeckAState>["loadSource"];

function Harness({ revision: _revision }: { revision: number }) {
  latestLoad = useDeckAState().loadSource;
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
