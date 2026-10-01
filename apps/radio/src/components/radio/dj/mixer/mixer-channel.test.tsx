import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { initializePlaybackSessions } from "@/lib/collections/playback-sessions";
import { getDjDeckModule } from "@/lib/dj-deck";

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
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
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

let MixerChannel: typeof import("./mixer-channel")["MixerChannel"];

beforeAll(async () => {
  ({ MixerChannel } = await import("./mixer-channel"));
});

const handleCueChange = () => undefined;

function renderDeckAChannel() {
  return render(
    <MixerChannel
      cueEnabled={false}
      deckId="deck-a"
      isCueActive={false}
      onCueChange={handleCueChange}
    />
  );
}

describe("MixerChannel", () => {
  beforeEach(async () => {
    await initializePlaybackSessions();
  });

  afterEach(() => {
    cleanup();
  });

  test.each([
    "Deck A volume",
    "Deck A filter",
    "Deck A effects mix",
    "Deck A pan",
    "Deck A speed",
  ])("throttles %s writes to the deck", async (name) => {
    const change = spyOn(getDjDeckModule().deck("deck-a"), "change");
    try {
      const view = renderDeckAChannel();
      const control = view.getByRole("slider", { name });

      for (let step = 0; step < 10; step += 1) {
        fireEvent.keyDown(control, { key: "ArrowUp" });
      }

      // Leading call now; the trailing one lands after the throttle window.
      expect(change).toHaveBeenCalledTimes(1);
      await act(() => Bun.sleep(50));
      expect(change).toHaveBeenCalledTimes(2);
    } finally {
      change.mockRestore();
    }
  });
});
