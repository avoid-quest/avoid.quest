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
import { setPlaybackChannelPeakLevel } from "@/lib/stores/playback-runtime-store";

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
let formatUtils: typeof import("../shared/format-utils");

beforeAll(async () => {
  ({ MixerChannel } = await import("./mixer-channel"));
  formatUtils = await import("../shared/format-utils");
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
    setPlaybackChannelPeakLevel("deck-a", { left: 0, right: 0 });
  });

  test("meter updates re-render only the meter, not the channel", () => {
    const formatPercent = spyOn(formatUtils, "formatPercent");
    try {
      const view = renderDeckAChannel();
      const meter = () =>
        view.container.querySelector('[style*="clip-path"]')?.outerHTML;
      const meterBefore = meter();
      const channelRenders = formatPercent.mock.calls.length;

      for (let tick = 1; tick <= 10; tick += 1) {
        act(() => {
          setPlaybackChannelPeakLevel("deck-a", {
            left: tick / 20,
            right: tick / 20,
          });
        });
      }

      expect(meter()).not.toBe(meterBefore);
      expect(formatPercent.mock.calls.length).toBe(channelRenders);
    } finally {
      formatPercent.mockRestore();
    }
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
