/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";
import type { Radio } from "@/lib/audio";

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
  CustomEvent: dom.window.CustomEvent,
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  fetch: () => Promise.reject(new Error("offline")),
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
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

// The real discovery over offline directories: only saved stations match.
// Another suite replaces this module for the whole run, so pin it here.
const { createStationDiscovery } = await import(
  "@/lib/stations/station-discovery"
);
const offline = { search: async () => [] };
mock.module("@/lib/stations/station-discovery-adapters", () => ({
  createProductionStationDiscovery: () =>
    createStationDiscovery({
      radioBrowser: offline,
      radioGarden: offline,
      streamProbe: { prepare: async () => null },
    }),
}));

// React DOM checks for input events when it loads, so it loads after the DOM.
const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

let StationNodeBody: typeof import("./station-node")["StationNodeBody"];

beforeAll(async () => {
  ({ StationNodeBody } = await import("./station-node"));
});

const kexp: Radio = {
  enabled: true,
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://radio.example/kexp.mp3",
};

const noop = () => undefined;
const PLAY_BUTTON = /^Play/;

type BodyProps = Parameters<typeof StationNodeBody>[0];

function renderBody(props: Partial<BodyProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StationNodeBody
        error={null}
        isLoading={false}
        isPlaying={false}
        muted={false}
        onSelectDiscovered={noop}
        onSelectLocal={noop}
        onToggleMute={noop}
        onTogglePlayPause={noop}
        onVolumeChange={noop}
        radio={null}
        radios={[kexp]}
        volume={1}
        {...props}
      />
    </QueryClientProvider>
  );
}

/** Fills itself from its own search, as the canvas does through the store. */
function SlotHarness({ onFill }: { onFill: (radio: Radio) => void }) {
  const [radio, setRadio] = useState<Radio | null>(null);
  const client = new QueryClient();
  const handleSelect = (picked: Radio) => {
    onFill(picked);
    setRadio(picked);
  };
  return (
    <QueryClientProvider client={client}>
      <StationNodeBody
        error={null}
        isLoading={false}
        isPlaying={false}
        muted={false}
        onSelectDiscovered={noop}
        onSelectLocal={handleSelect}
        onToggleMute={noop}
        onTogglePlayPause={noop}
        onVolumeChange={noop}
        radio={radio}
        radios={[kexp]}
        volume={1}
      />
    </QueryClientProvider>
  );
}

describe("StationNodeBody", () => {
  test("an empty Station is the station search", () => {
    const view = renderBody();

    expect(
      view.getByRole("combobox", { name: "Search stations" })
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: PLAY_BUTTON })).toBeNull();
  });

  test("picking a search result fills the Station", async () => {
    const onFill = mock((_radio: Radio) => undefined);
    const view = render(<SlotHarness onFill={onFill} />);

    // React DOM may have loaded before any DOM in a full run, in which case
    // it watches focus and key events for input instead of change events.
    const search = view.getByRole("combobox", { name: "Search stations" });
    fireEvent.focusIn(search);
    fireEvent.change(search, { target: { value: "KEXP" } });
    fireEvent.keyUp(search, { key: "P" });
    const result = await waitFor(() =>
      view.getByRole("button", { name: "Listen to KEXP" })
    );
    fireEvent.click(result);

    expect(onFill).toHaveBeenCalledWith(kexp);
    expect(
      view.queryByRole("combobox", { name: "Search stations" })
    ).toBeNull();
    expect(view.getByRole("button", { name: "Play KEXP" })).toBeTruthy();
    expect(view.getByRole("slider", { name: "Volume KEXP" })).toBeTruthy();
  });

  test("a play error shows as an inline error", () => {
    const view = renderBody({
      error: "Couldn't play KEXP: the stream is offline",
      radio: kexp,
    });

    expect(view.getByRole("alert").textContent).toBe(
      "Couldn't play KEXP: the stream is offline"
    );
  });

  test("a hidden station is greyed with no playback controls", () => {
    const view = renderBody({
      error: "stale error",
      radio: { ...kexp, enabled: false },
    });

    expect(view.getByText("Hidden. Show it to play here.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Play KEXP" })).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
  });
});
