import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  initializePlaybackSessions,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  resetPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
} from "@/lib/stores/playback-runtime-store";

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

Object.defineProperty(dom.window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    matches: false,
    media: query,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});

for (const [key, value] of Object.entries({
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  fetch: () => Promise.reject(new Error("offline")),
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  IntersectionObserver: ObserverStub,
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

const STATION: Radio = {
  id: "station-a",
  name: "Station A",
  streamUrl: "https://radio.test/a.mp3",
};

let DeckPanel: typeof import("./deck-panel")["DeckPanel"];

beforeAll(async () => {
  // The mobile console test replaces this module with mock.module, which
  // leaks across files in one `bun test` process. The query suffix loads a
  // real instance.
  ({ DeckPanel } = (await import(
    `./deck-panel.tsx?${"unmocked"}`
  )) as typeof import("./deck-panel"));
});

function setDeckRadio(channelId: string, radio: Radio | null) {
  updatePlaybackChannel("dj", channelId, (draft) => {
    draft.radio = radio;
  });
}

let soundsLanded = 0;

/**
 * Puts `radio` on deck A as a load that commits does: the deck's old sound
 * goes and a new one plays the source.
 */
function landSource(radio: Radio) {
  resetPlaybackChannelRuntime(DECK_A_CHANNEL_ID);
  setDeckRadio(DECK_A_CHANNEL_ID, radio);
  soundsLanded += 1;
  setPlaybackChannelSoundId(
    DECK_A_CHANNEL_ID,
    `left_${radio.id}:${soundsLanded}`
  );
}

/** A device or shared-tab source as deck A's device load builds it. */
function deviceSource(
  device: { deviceId: string; deviceLabel: string } & (
    | { capture: "display"; sourceUrl: string }
    | { capture?: undefined }
  )
): Radio {
  return {
    enabled: true,
    id: "device-input-left",
    name: device.deviceLabel,
    platformMetadata: {
      ...device,
      channelCount: 2,
      channelSelection: { left: 0, right: 1 },
      itemType: "track",
      platform: "device-input",
      url: "",
    },
    streamUrl: "",
  };
}

function renderDeckA() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DeckPanel deckId="deck-a" />
    </QueryClientProvider>
  );
}

function isPickerOpen(view: ReturnType<typeof renderDeckA>) {
  return view.queryByRole("tab", { name: "Other sources" }) !== null;
}

const CHANGE_SOURCE = /change source/i;
const CHANGE_DEVICE = /change device/i;

function openSourcePicker(view: ReturnType<typeof renderDeckA>) {
  fireEvent.click(view.getByRole("button", { name: CHANGE_SOURCE }));
  expect(isPickerOpen(view)).toBeTrue();
}

describe("DeckPanel source picker", () => {
  // The DJ session outlives each test, so what a test writes is put back.
  let volumesBefore = new Map<string, number>();

  beforeEach(async () => {
    await initializePlaybackSessions();
    volumesBefore = new Map(
      [DECK_A_CHANNEL_ID, DECK_B_CHANNEL_ID].map((channelId) => [
        channelId,
        getPlaybackChannel("dj", channelId)?.volume ?? 1,
      ])
    );
    setDeckRadio(DECK_A_CHANNEL_ID, STATION);
  });

  afterEach(() => {
    cleanup();
    resetPlaybackChannelRuntime(DECK_A_CHANNEL_ID);
    setDeckRadio(DECK_A_CHANNEL_ID, null);
    for (const [channelId, volume] of volumesBefore) {
      updatePlaybackChannel("dj", channelId, (draft) => {
        draft.volume = volume;
      });
    }
  });

  test("stays open while either deck's channel settings change", () => {
    const view = renderDeckA();
    openSourcePicker(view);

    act(() => {
      updatePlaybackChannel("dj", DECK_B_CHANNEL_ID, (draft) => {
        draft.volume = 0.3;
      });
      updatePlaybackChannel("dj", DECK_A_CHANNEL_ID, (draft) => {
        draft.volume = 0.5;
      });
    });

    expect(isPickerOpen(view)).toBeTrue();
  });

  test("closes when a different source lands on the deck", () => {
    const view = renderDeckA();
    openSourcePicker(view);

    act(() => {
      setDeckRadio(DECK_A_CHANNEL_ID, {
        id: "station-b",
        name: "Station B",
        streamUrl: "https://radio.test/b.mp3",
      });
    });

    expect(isPickerOpen(view)).toBeFalse();
  });

  test("closes when another device source lands under the deck's device id", () => {
    landSource(
      deviceSource({
        capture: "display",
        deviceId: "display",
        deviceLabel: "Shared tab",
        sourceUrl: "https://radio.test/show",
      })
    );
    const view = renderDeckA();
    fireEvent.click(view.getByRole("button", { name: CHANGE_DEVICE }));
    expect(isPickerOpen(view)).toBeTrue();

    act(() => {
      landSource(deviceSource({ deviceId: "mic", deviceLabel: "Microphone" }));
    });

    expect(isPickerOpen(view)).toBeFalse();
  });
});
