import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";
import { RadioNowPlaying } from "./radio-now-playing";
import { NowPlayingPanel } from "./single/single-player-now-playing";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

class ResizeObserverStub {
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
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  ResizeObserver: ResizeObserverStub,
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

afterEach(cleanup);

const metadata: RadioNowPlayingMetadata = {
  album: "Series Name",
  artist: "Host Name",
  artworkUrl: "https://radio.example/current-show.jpg",
  bitrate: null,
  expiresAt: 2000,
  genre: "Ambient",
  itemUrl: "https://radio.example/shows/current-show",
  rawTitle: "Host Name - Current Show",
  resolvedUrl: "https://radio.example/api/now-playing",
  sampledAt: 1000,
  source: "airtime-live-info",
  stationDescription: "Current show description.",
  stationName: "Example Radio",
  streamUrl: "https://radio.example/live",
  title: "Current Show",
};

const noop = () => undefined;

describe("RadioNowPlaying", () => {
  test("renders rich current-item metadata in detailed mode", () => {
    const view = render(
      <RadioNowPlaying metadata={metadata} showDetails={true} />
    );

    expect(view.getByText("Host Name - Current Show")).toBeTruthy();
    expect(view.getByText("Series Name · Ambient")).toBeTruthy();
    expect(view.getByText("Current show description.")).toBeTruthy();
    expect(
      view
        .getByRole("link", { name: "More info about this show or track" })
        .getAttribute("href")
    ).toBe("https://radio.example/shows/current-show");
  });

  test("uses current artwork and description in the main player", () => {
    const radio: Radio = {
      description: "Static station description.",
      logoUrl: "https://radio.example/station-logo.jpg",
      name: "Example Radio",
      streamUrl: "https://radio.example/live",
    };
    const view = render(
      <NowPlayingPanel
        error={null}
        isLoading={false}
        isMuted={false}
        isPlaying={true}
        metadata={metadata}
        onMuteToggle={noop}
        onPlayPause={noop}
        onVolumeChange={noop}
        radio={radio}
        volume={1}
      />
    );

    expect(
      view
        .getByRole("img", { name: "Current Show artwork" })
        .getAttribute("src")
    ).toBe("https://radio.example/current-show.jpg");
    expect(view.getByText("Current show description.")).toBeTruthy();
    expect(view.queryByText("Static station description.")).toBeNull();
  });
});
