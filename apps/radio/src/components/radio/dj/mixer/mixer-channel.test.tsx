import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  spyOn,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { AudioManager } from "@/lib/audio";
import { initializePlaybackSessions } from "@/lib/collections/playback-sessions";
import { getDjDeckModule } from "@/lib/dj-deck";
import { setPlaybackChannelPeakLevel } from "@/lib/stores/playback-runtime-store";
import { installAnimationTestEnvironment } from "../shared/animation-test-utils";
import { MixerMaster } from "./mixer-master";

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

  test("sixty meter samples animate without rendering channel controls", () => {
    const clock = installAnimationTestEnvironment();
    const formatPercent = spyOn(formatUtils, "formatPercent");
    try {
      const view = renderDeckAChannel();
      const meter = () =>
        view.container.querySelector<HTMLElement>("[data-meter-fill]")?.style
          .transform;
      const channelRenders = formatPercent.mock.calls.length;
      for (let tick = 1; tick <= 60; tick += 1) {
        act(() =>
          setPlaybackChannelPeakLevel("deck-a", {
            left: tick / 100,
            right: tick / 100,
          })
        );
        clock.advance(1000 / 60);
      }
      expect(meter()).not.toBe("scaleY(0)");
      expect(formatPercent.mock.calls.length).toBe(channelRenders);
    } finally {
      cleanup();
      formatPercent.mockRestore();
      clock.restore();
    }
  });

  test("master samples do not render master volume or cue controls", () => {
    const clock = installAnimationTestEnvironment();
    let publish: ((level: { left: number; right: number }) => void) | undefined;
    const subscribe = spyOn(
      AudioManager.getInstance(),
      "subscribeMasterMeter"
    ).mockImplementation((listener) => {
      publish = listener;
      return () => undefined;
    });
    const formatPercent = spyOn(formatUtils, "formatPercent");
    try {
      const view = render(
        <MixerMaster
          headphoneVolume={1}
          isCueActive={true}
          masterVolume={1}
          onHeadphoneVolumeChange={handleCueChange}
          onMasterVolumeChange={handleCueChange}
        />
      );
      const baseline = formatPercent.mock.calls.length;
      for (let tick = 1; tick <= 60; tick += 1) {
        publish?.({ left: tick / 100, right: tick / 100 });
        clock.advance(1000 / 60);
      }
      expect(
        view.container.querySelector<HTMLElement>("[data-meter-fill]")?.style
          .transform
      ).not.toBe("scaleY(0)");
      expect(formatPercent.mock.calls.length).toBe(baseline);
    } finally {
      cleanup();
      subscribe.mockRestore();
      formatPercent.mockRestore();
      clock.restore();
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
    jest.useFakeTimers();
    try {
      const view = renderDeckAChannel();
      const control = view.getByRole("slider", { name });

      for (let step = 0; step < 10; step += 1) {
        fireEvent.keyDown(control, { key: "ArrowUp" });
      }

      // Leading call now; the trailing one lands after the throttle window.
      expect(change).toHaveBeenCalledTimes(1);
      await act(() => {
        jest.advanceTimersByTime(32);
      });
      expect(change).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      change.mockRestore();
    }
  });
});
