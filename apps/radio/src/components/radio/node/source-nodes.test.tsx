/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  forgetLocalFileUrls,
  keepLocalFileUrl,
} from "@/lib/node-graph/sources";

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
  cancelAnimationFrame: dom.window.cancelAnimationFrame,
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
  // Radix Tabs (DJ's file form) schedules on animation frames.
  requestAnimationFrame: dom.window.requestAnimationFrame,
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

// A pick or pasted link resolves through DJ's track loader; its platform
// request is the seam. Nothing else imports this module.
const platformLoads: string[] = [];
let platformResult: Radio | null = null;
mock.module("@/lib/hooks/use-platform-query", () => ({
  platformKeys: { all: ["platform"] },
  usePlatformItem: () => ({ data: null }),
  usePlatformLoad: () => ({
    isPending: false,
    load: (
      url: string,
      callbacks: {
        onSuccess?: (radio: Radio) => void;
        onError?: (message: string) => void;
      } = {}
    ) => {
      platformLoads.push(url);
      if (platformResult) {
        callbacks.onSuccess?.(platformResult);
      } else {
        callbacks.onError?.("Unsupported platform URL");
      }
    },
  }),
}));

// React DOM checks for input events when it loads, so it loads after the DOM.
const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
  platformLoads.length = 0;
  platformResult = null;
  forgetLocalFileUrls();
});

let TrackNodeBody: typeof import("./track-node")["TrackNodeBody"];
let FileNodeBody: typeof import("./file-node")["FileNodeBody"];
let StationNodeBody: typeof import("./station-node")["StationNodeBody"];

beforeAll(async () => {
  ({ TrackNodeBody } = await import("./track-node"));
  ({ FileNodeBody } = await import("./file-node"));
  ({ StationNodeBody } = await import("./station-node"));
});

const noop = () => undefined;

const transport = {
  isLoading: false,
  isPlaying: false,
  muted: false,
  onToggleMute: noop,
  onTogglePlayPause: noop,
  onVolumeChange: noop,
  volume: 1,
};

const video: Radio = {
  id: "yt-abc",
  name: "A video",
  platformMetadata: {
    itemType: "video",
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
    videoId: "abc",
  },
  streamUrl: "https://media.example/abc.m4a",
};

function withClient(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A Track that fills itself, as the canvas does through the store. */
function TrackHarness({ onFill }: { onFill: (radio: Radio) => void }) {
  const [radio, setRadio] = useState<Radio | null>(null);
  return withClient(
    <TrackNodeBody
      data={{ muted: false, radio, volume: 1 }}
      error={null}
      onLoad={(picked) => {
        onFill(picked);
        setRadio(picked);
      }}
      onSearchPlatformChange={noop}
      {...transport}
    />
  );
}

function pasteLink(
  view: ReturnType<typeof render>,
  name: string | RegExp,
  url: string
) {
  const field = view.getByRole(
    name === "Search stations" ? "combobox" : "searchbox",
    { name }
  );
  fireEvent.focusIn(field);
  fireEvent.change(field, { target: { value: url } });
  return field;
}

describe("TrackNodeBody", () => {
  test("an empty Track is DJ's platform search, with All and DJ's platform chips", () => {
    const onSearchPlatformChange = mock(() => undefined);
    const view = render(
      withClient(
        <TrackNodeBody
          data={{ muted: false, radio: null, volume: 1 }}
          error={null}
          onLoad={noop}
          onSearchPlatformChange={onSearchPlatformChange}
          {...transport}
        />
      )
    );

    const chips = view
      .getAllByRole("button", { pressed: false })
      .map((chip) => chip.textContent);
    expect(chips).toEqual(["YouTube", "SoundCloud", "Bandcamp"]);
    expect(view.getByRole("button", { pressed: true }).textContent).toBe("All");
    expect(
      view.getByRole("searchbox", { name: "Search or paste a link" })
    ).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "SoundCloud" }));
    expect(onSearchPlatformChange).toHaveBeenCalledWith("soundcloud");
  });

  test("a pasted YouTube link loads through DJ's track loader and fills the Track", async () => {
    platformResult = video;
    const onFill = mock((_radio: Radio) => undefined);
    const view = render(<TrackHarness onFill={onFill} />);

    const field = pasteLink(
      view,
      "Search or paste a link",
      "https://www.youtube.com/watch?v=abc"
    );
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() => expect(onFill).toHaveBeenCalledWith(video));
    expect(platformLoads).toEqual(["https://www.youtube.com/watch?v=abc"]);
    expect(view.getByRole("button", { name: "Play A video" })).toBeTruthy();
    expect(view.getByText("YouTube")).toBeTruthy();
  });
});

describe("FileNodeBody", () => {
  const picked: Radio = {
    id: "local-file-file-1",
    name: "Demo",
    platformMetadata: {
      displayName: "Demo",
      duration: 10,
      fileName: "demo.mp3",
      fileSize: 100,
      itemType: "track",
      mimeType: "audio/mpeg",
      objectUrl: "blob:https://radio.test/demo",
      platform: "local-file",
      url: "",
    },
    streamUrl: "blob:https://radio.test/demo",
  };

  function renderFile(
    radio: Radio | null,
    onLoadFile = mock(async () => null)
  ) {
    return {
      onLoadFile,
      view: render(
        <FileNodeBody
          data={{ muted: false, radio, volume: 1 }}
          error={null}
          onLoadFile={onLoadFile}
          onLoadUrl={async () => null}
          {...transport}
        />
      ),
    };
  }

  test("an empty File is DJ's file form, and a picked file loads", async () => {
    const { onLoadFile, view } = renderFile(null);

    expect(view.getByRole("tab", { name: "Local file" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Remote URL" })).toBeTruthy();
    const input = view.container.querySelector(
      "input[type=file]"
    ) as HTMLInputElement;
    const file = new File(["x"], "demo.mp3", { type: "audio/mpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onLoadFile).toHaveBeenCalledWith(file));
  });

  test("a local file from an earlier page asks to be picked again", () => {
    const { view } = renderFile(picked);

    expect(view.getByText("Pick the file again")).toBeTruthy();
    expect(view.getByText("Demo")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Play Demo" })).toBeNull();
  });

  test("a file picked in this page plays", () => {
    keepLocalFileUrl(picked.streamUrl);
    const { view } = renderFile(picked);

    expect(view.queryByText("Pick the file again")).toBeNull();
    expect(view.getByRole("button", { name: "Play Demo" })).toBeTruthy();
  });
});

describe("StationNodeBody: a pasted stream", () => {
  test("offers the link instead of a search, and plays it", async () => {
    const onSubmitUrl = mock(async (_url: string) => null);
    const view = render(
      withClient(
        <StationNodeBody
          error={null}
          onSelectDiscovered={noop}
          onSelectLocal={noop}
          onSubmitUrl={onSubmitUrl}
          radio={null}
          radios={[]}
          {...transport}
        />
      )
    );

    const field = pasteLink(
      view,
      "Search stations",
      "https://stream.example/live"
    );
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(onSubmitUrl).toHaveBeenCalledWith("https://stream.example/live")
    );
  });

  test("says why a link didn't load", async () => {
    const view = render(
      withClient(
        <StationNodeBody
          error={null}
          onSelectDiscovered={noop}
          onSelectLocal={noop}
          onSubmitUrl={async () => "The stream could not be reached"}
          radio={null}
          radios={[]}
          {...transport}
        />
      )
    );

    const field = pasteLink(
      view,
      "Search stations",
      "https://stream.example/down"
    );
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "The stream could not be reached"
      )
    );
  });
});
