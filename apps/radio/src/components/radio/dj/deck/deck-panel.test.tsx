import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  addSessionRadio,
  removeSessionRadio,
} from "@/lib/collections/session-radios";
import { getDjDeckModule } from "@/lib/dj-deck";
import { PLATFORM_ITEMS } from "@/lib/dj-library-sources";
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
  CustomEvent: dom.window.CustomEvent,
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  Event: dom.window.Event,
  fetch: () => Promise.reject(new Error("offline")),
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
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

// Input change detection must initialize after the DOM is available.
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

const SESSION_STATION: Radio = {
  id: "rb_deck-search-session-regression",
  name: "Session-only deck regression station",
  streamUrl: "https://radio.test/session-only-deck.mp3",
};

const STATION: Radio = {
  id: "station-a",
  name: "Station A",
  streamUrl: "https://radio.test/a.mp3",
};

let DeckPanel: typeof import("./deck-panel")["DeckPanel"];
let realUseSessionRadios: typeof import("@/lib/hooks/use-session-radios")["useSessionRadios"];
let restoreSessionHook: () => void = () => undefined;

beforeAll(async () => {
  // The Node-management suite replaces the session hook globally. Keep the
  // real collection-backed hook available without adding another module mock.
  ({ useSessionRadios: realUseSessionRadios } = (await import(
    `../../../../lib/hooks/use-session-radios.ts?${"deck-real-sessions"}`
  )) as typeof import("@/lib/hooks/use-session-radios"));
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
    const sessionHooks = await import("@/lib/hooks/use-session-radios");
    const sessionHook = spyOn(
      sessionHooks,
      "useSessionRadios"
    ).mockImplementation(realUseSessionRadios);
    restoreSessionHook = () => sessionHook.mockRestore();
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
    restoreSessionHook();
    resetPlaybackChannelRuntime(DECK_A_CHANNEL_ID);
    setDeckRadio(DECK_A_CHANNEL_ID, null);
    getDjDeckModule().pendingSource.cancel("deck-a");
    removeSessionRadio(SESSION_STATION.id as string);
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

  for (const surface of ["pending platform", "change loaded source"] as const) {
    test(`${surface} search finds a station held only in the session library`, async () => {
      addSessionRadio(SESSION_STATION);
      if (surface === "pending platform") {
        const [searchSource] = PLATFORM_ITEMS;
        if (!searchSource) {
          throw new Error("Missing search source");
        }
        await getDjDeckModule()
          .deck("deck-a")
          .load({ radio: searchSource, type: "library" });
      } else {
        setDeckRadio(DECK_A_CHANNEL_ID, {
          ...STATION,
          platformMetadata: {
            itemType: "track",
            platform: "soundcloud",
            url: "https://soundcloud.com/artist/track",
          },
        });
      }
      const view = renderDeckA();
      if (surface === "change loaded source") {
        fireEvent.click(view.getByRole("button", { name: CHANGE_SOURCE }));
      }
      const provider = view.container.querySelector("select");
      if (!provider) {
        throw new Error("Missing provider selector");
      }
      fireEvent.change(provider, { target: { value: "local" } });
      const input = view.getByRole("searchbox", {
        name: "Search or paste a link",
      });
      fireEvent.change(input, { target: { value: SESSION_STATION.name } });
      const form = input.closest("form");
      if (!form) {
        throw new Error("Missing search form");
      }
      fireEvent.submit(form);
      await waitFor(() =>
        expect(view.queryByText(SESSION_STATION.name) !== null).toBe(true)
      );
    });
  }
});
