import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
  within,
} from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import {
  radioMetadataKeys,
  radioMetadataPreviewRefreshInterval,
  radioMetadataRefreshInterval,
} from "@/lib/hooks/use-radio-metadata";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
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
  CustomEvent: dom.window.CustomEvent,
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
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

let RadioNowPlaying: typeof import("./radio-now-playing")["RadioNowPlaying"];
let NowPlayingPanel: typeof import("./single/single-player-now-playing")["NowPlayingPanel"];
let StationNodeBody: typeof import("./node/station-node")["StationNodeBody"];
let StationList: typeof import("./single/single-player-station-list")["StationList"];
let useRadioMetadata: typeof import("@/lib/hooks/use-radio-metadata")["useRadioMetadata"];

beforeAll(async () => {
  ({ RadioNowPlaying } = await import("./radio-now-playing"));
  ({ NowPlayingPanel } = await import("./single/single-player-now-playing"));
  ({ StationNodeBody } = await import("./node/station-node"));
  ({ StationList } = await import("./single/single-player-station-list"));
  ({ useRadioMetadata } = await import("@/lib/hooks/use-radio-metadata"));
});

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
const radio: Radio = {
  description: "Static station description.",
  logoUrl: "https://radio.example/station-logo.jpg",
  metadataConfig: { kind: "icy" },
  name: "Example Radio",
  streamUrl: "https://radio.example/live",
};

test("polls at the server's remaining cache lifetime in the browser's clock", () => {
  const response = {
    data: metadata,
    ok: true,
    refreshAfterMs: 900_000,
  } as const;
  expect(radioMetadataRefreshInterval(response, 1000, 30_000)).toBe(871_000);
  expect(radioMetadataRefreshInterval(response, 1000, 901_000)).toBe(30_000);
  expect(
    radioMetadataRefreshInterval(
      { data: metadata, ok: true, refreshAfterMs: 0 },
      1000,
      1000
    )
  ).toBe(30_000);
  expect(
    radioMetadataRefreshInterval(
      {
        error: {
          code: "RADIO_METADATA_UNSUPPORTED",
          message: "No source",
        },
        ok: false,
      },
      1000,
      1000
    )
  ).toBe(60_000);
  expect(radioMetadataRefreshInterval(response, 1000, 30_000, true)).toBe(
    60_000
  );
  expect(
    radioMetadataRefreshInterval({ data: metadata, ok: true }, 1000, 1000)
  ).toBe(30_000);
  expect(
    radioMetadataRefreshInterval(
      { data: metadata, ok: true, refreshAfterMs: Number.NaN },
      1000,
      1000
    )
  ).toBe(30_000);
  expect(
    radioMetadataRefreshInterval(
      { data: metadata, ok: true, refreshAfterMs: 10_000_000 },
      1000,
      1000
    )
  ).toBe(3_600_000);
});

test("refreshes previews after the server deadline, never faster than 5 minutes", () => {
  const ok = (refreshAfterMs: number) => ({
    data: metadata,
    ok: true as const,
    refreshAfterMs,
  });
  // A show ending in an hour: refetch when it ends.
  expect(radioMetadataPreviewRefreshInterval(ok(3_600_000), 0, 0)).toBe(
    3_600_000
  );
  // Short deadlines (e.g. per-track ICY) are held to the 5-minute floor.
  expect(radioMetadataPreviewRefreshInterval(ok(60_000), 0, 0)).toBe(300_000);
  // Time already spent counts toward the deadline.
  expect(radioMetadataPreviewRefreshInterval(ok(3_600_000), 0, 3_000_000)).toBe(
    600_000
  );
  // No metadata, or no deadline: no background requests.
  expect(
    radioMetadataPreviewRefreshInterval(
      { error: { code: "X", message: "" }, ok: false } as never,
      0,
      0
    )
  ).toBeFalse();
  expect(radioMetadataPreviewRefreshInterval(undefined, 0, 0)).toBeFalse();
  expect(
    radioMetadataPreviewRefreshInterval(
      { data: metadata, ok: true } as never,
      0,
      0
    )
  ).toBeFalse();
});

test("gates preview requests and refreshes metadata when polling starts", async () => {
  const client = new QueryClient();
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    (input: Parameters<typeof fetch>[0]) => {
      requests.push(String(input));
      return Promise.resolve(Response.json({ data: metadata, ok: true }));
    },
    { preconnect: originalFetch.preconnect }
  );

  try {
    const view = renderHook(
      ({ enabled, poll }) => useRadioMetadata({ enabled, poll, radio }),
      {
        initialProps: { enabled: false, poll: false },
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(requests).toHaveLength(0);
    view.rerender({ enabled: true, poll: false });
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(view.result.current.metadata).toEqual(metadata));

    await act(async () => {
      await client.invalidateQueries({
        queryKey: radioMetadataKeys.stream(
          radio.streamUrl,
          radio.metadataConfig
        ),
        refetchType: "none",
      });
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);

    view.rerender({ enabled: true, poll: true });
    await waitFor(() => expect(requests).toHaveLength(2));
  } finally {
    act(() => focusManager.setFocused(undefined));
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test("keeps a fresh preview through playback and refreshes after its deadline", async () => {
  const client = new QueryClient();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const requests: string[] = [];
  const servedAt = Date.now();
  let now = servedAt;
  const response = {
    data: { ...metadata, expiresAt: servedAt + 60_000, sampledAt: servedAt },
    ok: true,
    refreshAfterMs: 60_000,
  };
  globalThis.fetch = Object.assign(
    (input: Parameters<typeof fetch>[0]) => {
      requests.push(String(input));
      return Promise.resolve(Response.json(response));
    },
    { preconnect: originalFetch.preconnect }
  );

  try {
    // Keep the fixture and query receipt on the same clock, regardless of latency.
    Date.now = () => now;
    const view = renderHook(({ poll }) => useRadioMetadata({ poll, radio }), {
      initialProps: { poll: false },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(view.result.current.metadata).toBeTruthy());
    view.rerender({ poll: true });
    await act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(requests).toHaveLength(1);

    now = servedAt + 59_999;
    await act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(requests).toHaveLength(1);

    now = servedAt + 60_001;
    await act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(requests).toHaveLength(2));
  } finally {
    Date.now = originalNow;
    act(() => focusManager.setFocused(undefined));
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

describe("RadioNowPlaying", () => {
  for (const variant of ["featured", "compact"] as const) {
    test(`shows player genres under the subtitle and full Details in ${variant} mode`, () => {
      const view = render(
        <RadioNowPlaying
          metadata={{
            ...metadata,
            genre: " Art Pop, Downtempo, , Art Pop, R&B / Soul ",
          }}
          radio={radio}
          variant={variant}
        />
      );
      const playerGenres = view.getByRole("list");
      const artworkButton = view.getByRole("button", {
        name: "Details for Current Show",
      });
      expect(artworkButton.contains(playerGenres)).toBe(false);
      expect(
        view.getByText("Host Name").parentElement?.contains(playerGenres)
      ).toBe(true);
      const visiblePills = within(playerGenres)
        .getAllByRole("listitem")
        .map((pill) => pill.textContent);
      if (variant === "featured") {
        expect(visiblePills).toEqual(["Art Pop", "Downtempo", "R&B / Soul"]);
        expect(view.getByText("Example Radio").nextElementSibling).toBe(
          view.getByRole("heading", { name: "Current Show" })
        );
      } else {
        expect(visiblePills).toEqual(["Art Pop", "+22 more genres in Details"]);
      }

      fireEvent.click(
        view.getByRole("button", { name: "Details for Current Show" })
      );
      const details = within(view.getByRole("dialog"));
      const genres = details.getByRole("list");
      const pills = within(genres).getAllByRole("listitem");
      expect(pills.map((pill) => pill.textContent)).toEqual([
        "Art Pop",
        "Downtempo",
        "R&B / Soul",
      ]);
      for (const pill of pills) {
        expect(pill.firstElementChild?.getAttribute("data-slot")).toBe("badge");
      }
      expect(within(genres).queryByRole("button")).toBeNull();
      expect(within(genres).queryByRole("link")).toBeNull();
    });
  }

  for (const genre of [null, "", " , , "]) {
    test(`omits empty genre rows for ${JSON.stringify(genre)}`, () => {
      const view = render(
        <RadioNowPlaying
          metadata={{ ...metadata, genre }}
          radio={radio}
          variant="featured"
        />
      );
      expect(view.queryByRole("list")).toBeNull();
      fireEvent.click(
        view.getByRole("button", { name: "Details for Current Show" })
      );
      expect(within(view.getByRole("dialog")).queryByRole("list")).toBeNull();
    });
  }

  for (const variant of ["featured", "compact"] as const) {
    test(`uses the same show identity and details in ${variant} mode`, () => {
      const view = render(
        <RadioNowPlaying metadata={metadata} radio={radio} variant={variant} />
      );

      expect(view.getByRole("heading", { name: "Current Show" })).toBeTruthy();
      expect(view.getByText("Host Name")).toBeTruthy();
      expect(view.getByText("Example Radio")).toBeTruthy();
      expect(view.queryByText("Now playing")).toBeNull();
      expect(view.queryByText("Ready")).toBeNull();
      expect(view.queryByRole("status")).toBeNull();
      const detailsButton = view.getByRole("button", {
        name: "Details for Current Show",
      });
      expect(view.queryByText("Details")).toBeNull();
      expect(
        within(detailsButton).getByRole("img", { name: "Current Show artwork" })
      ).toBeTruthy();
      expect(detailsButton.getAttribute("title")).toBe(
        "View details for Current Show"
      );
      expect(view.queryByText("Current show description.")).toBeNull();
      expect(
        view.getByRole("link", { name: "Current Show" }).getAttribute("href")
      ).toBe(metadata.itemUrl);

      fireEvent.click(
        view.getByRole("button", { name: "Details for Current Show" })
      );
      const details = within(
        view.getByRole("dialog", { name: "Current Show" })
      );
      expect(details.getByText("Series Name")).toBeTruthy();
      expect(details.getByText("Ambient")).toBeTruthy();
      expect(details.getByText("Current show description.")).toBeTruthy();
      expect(
        details
          .getByRole("link", { name: "Open source page" })
          .getAttribute("href")
      ).toBe(metadata.itemUrl);
    });
  }

  for (const variant of ["featured", "compact"] as const) {
    for (const nowPlaying of [metadata, null]) {
      test(`shows only a transient connection status in ${variant} mode ${nowPlaying ? "with" : "without"} metadata`, () => {
        const view = render(
          <RadioNowPlaying
            isLoading={true}
            metadata={nowPlaying}
            radio={radio}
            variant={variant}
          />
        );
        expect(view.getByRole("status").textContent).toBe("Connecting…");
        expect(
          view.getByRole("heading", { name: nowPlaying?.title ?? radio.name })
        ).toBeTruthy();
        view.rerender(
          <RadioNowPlaying
            isLoading={false}
            metadata={nowPlaying}
            radio={radio}
            variant={variant}
          />
        );
        expect(view.queryByRole("status")).toBeNull();
        expect(view.queryByText("Now playing")).toBeNull();
        expect(view.queryByText("Ready")).toBeNull();
      });
    }
  }

  test("falls back to station identity without inventing current show data", () => {
    const view = render(<RadioNowPlaying radio={radio} />);
    expect(view.getByRole("heading", { name: "Example Radio" })).toBeTruthy();
    expect(view.queryByText("Ready")).toBeNull();
    expect(view.getAllByText("Example Radio")).toHaveLength(1);
    expect(view.container.querySelector("section p")).toBeNull();
    expect(view.queryByRole("link")).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: "Details for Example Radio" })
    );
    expect(view.getByText("Static station description.")).toBeTruthy();
  });

  test("labels show copy neutrally and keeps separate station information", () => {
    const view = render(
      <RadioNowPlaying
        metadata={{ ...metadata, bitrate: 192 }}
        radio={{
          ...radio,
          countryTitle: "Germany",
          placeTitle: "Berlin",
          streamFormat: "hls",
          websiteUrl: "https://radio.example/",
        }}
      />
    );
    fireEvent.click(
      view.getByRole("button", { name: "Details for Current Show" })
    );
    const details = within(view.getByRole("dialog"));
    expect(details.getByRole("heading", { name: "Description" })).toBeTruthy();
    expect(
      details.getByRole("heading", { level: 3, name: "Example Radio" })
    ).toBeTruthy();
    expect(details.getByText("Current show description.")).toBeTruthy();
    expect(details.getByText("Static station description.")).toBeTruthy();
    expect(details.getByText("Berlin, Germany")).toBeTruthy();
    const stationLink = details.getByRole("link", { name: "Station website" });
    expect(stationLink.getAttribute("href")).toBe("https://radio.example/");
    expect(stationLink.getAttribute("target")).toBe("_blank");
    expect(stationLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      details
        .getByText("Stream information")
        .parentElement?.hasAttribute("open")
    ).toBe(false);
    expect(details.getByText("192 kbps")).toBeTruthy();
    expect(details.getByText("HLS")).toBeTruthy();
    expect(details.getByText("Host Name - Current Show")).toBeTruthy();
    expect(details.getByText(metadata.streamUrl)).toBeTruthy();
    expect(
      details.getByText("https://radio.example/api/now-playing")
    ).toBeTruthy();
    expect(details.getByText(metadata.source)).toBeTruthy();
    expect(
      details.getByText(new Date(metadata.sampledAt).toLocaleString())
    ).toBeTruthy();
  });

  for (const identity of [
    { artist: "Track Artist", title: "Track Title" },
    { artist: "Track Artist", title: null },
    { artist: null, title: null },
  ]) {
    test(`labels provider station copy neutrally with identity ${JSON.stringify(identity)}`, () => {
      const description = "Independent community radio broadcasting worldwide.";
      const view = render(
        <RadioNowPlaying
          metadata={{
            ...metadata,
            ...identity,
            stationDescription: description,
          }}
          radio={radio}
        />
      );
      fireEvent.click(
        view.getByRole("button", {
          name: `Details for ${identity.title ?? identity.artist ?? radio.name}`,
        })
      );
      const details = within(view.getByRole("dialog"));
      expect(
        details.getByRole("heading", { name: "Description" })
      ).toBeTruthy();
      expect(details.getByText(description)).toBeTruthy();
      expect(details.getByText("Static station description.")).toBeTruthy();
      expect(
        details.queryByRole("heading", { name: "About this broadcast" })
      ).toBeNull();
    });
  }

  for (const description of [null, "", " \n "]) {
    test(`omits empty provider description ${JSON.stringify(description)}`, () => {
      const view = render(
        <RadioNowPlaying
          metadata={{ ...metadata, stationDescription: description }}
          radio={radio}
        />
      );
      fireEvent.click(
        view.getByRole("button", { name: "Details for Current Show" })
      );
      const details = within(view.getByRole("dialog"));
      expect(
        details.queryByRole("heading", { name: "Description" })
      ).toBeNull();
      expect(details.getByText("Static station description.")).toBeTruthy();
    });
  }

  test("does not repeat identical descriptions or render unsafe station links", () => {
    const view = render(
      <RadioNowPlaying
        metadata={{
          ...metadata,
          stationDescription: "  Static station description. \n",
        }}
        radio={{ ...radio, websiteUrl: "javascript:alert(1)" }}
      />
    );
    fireEvent.click(
      view.getByRole("button", { name: "Details for Current Show" })
    );
    const details = within(view.getByRole("dialog"));
    expect(details.getAllByText("Static station description.")).toHaveLength(1);
    expect(details.queryByRole("heading", { name: "Description" })).toBeNull();
    expect(details.queryByRole("link", { name: "Station website" })).toBeNull();
  });

  test("recovers from a failed artwork URL when the show changes", () => {
    const view = render(<RadioNowPlaying metadata={metadata} radio={radio} />);
    fireEvent.error(view.getByRole("img", { name: "Current Show artwork" }));
    expect(
      view.getByRole("img", { name: "Example Radio logo" }).getAttribute("src")
    ).toBe(radio.logoUrl ?? null);
    view.rerender(
      <RadioNowPlaying
        metadata={{ ...metadata, artworkUrl: "https://radio.example/next.jpg" }}
        radio={radio}
      />
    );
    expect(
      view
        .getByRole("img", { name: "Current Show artwork" })
        .getAttribute("src")
    ).toBe("https://radio.example/next.jpg");
  });

  test("opens details from the fallback artwork when no image is available", () => {
    const view = render(
      <RadioNowPlaying radio={{ ...radio, logoUrl: undefined }} />
    );
    const trigger = view.getByRole("button", {
      name: "Details for Example Radio",
    });
    expect(trigger.getAttribute("type")).toBe("button");
    expect(view.queryByText("Details")).toBeNull();
    fireEvent.click(trigger);
    expect(view.getByRole("dialog", { name: "Example Radio" })).toBeTruthy();
    expect(view.getByText("Static station description.")).toBeTruthy();
  });

  test("keeps complete long text in Details without inventing a missing link", () => {
    const title =
      "A very long broadcast title with many guests and recordings ".repeat(4);
    const description =
      "A complete episode description that must remain readable. ".repeat(30);
    const view = render(
      <RadioNowPlaying
        metadata={{
          ...metadata,
          artworkUrl: null,
          itemUrl: null,
          stationDescription: description,
          title,
        }}
        radio={radio}
      />
    );
    expect(view.queryByRole("link")).toBeNull();
    expect(view.getByRole("heading").textContent).toBe(title);
    fireEvent.click(
      view.getByRole("button", { name: `Details for ${title.trim()}` })
    );
    const details = within(view.getByRole("dialog"));
    expect(details.getByRole("heading", { level: 2 }).textContent).toBe(title);
    expect(details.getByText(description.trim()).textContent).toBe(
      description.trim()
    );
  });

  test("makes show details available from the Single player", () => {
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
    expect(
      view.getByRole("heading", { level: 2, name: "Current Show" })
    ).toBeTruthy();
    expect(view.queryByText("Static station description.")).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: "Details for Current Show" })
    );
    expect(view.getByText("Current show description.")).toBeTruthy();
  });

  test("previews current metadata and full details from the Single station list", () => {
    const listedRadio = { ...radio, id: "example-radio" };
    const client = new QueryClient();
    client.setQueryData(
      radioMetadataKeys.stream(radio.streamUrl, radio.metadataConfig),
      {
        data: metadata,
        ok: true,
      }
    );
    const view = render(
      <QueryClientProvider client={client}>
        <StationList
          currentRadioId={listedRadio.id}
          isPlaying={false}
          onDelete={noop}
          onEdit={noop}
          onSave={noop}
          onSelect={noop}
          onToggle={noop}
          onTogglePlayPause={noop}
          radios={[listedRadio]}
          searchBar={null}
          sessionRadios={[]}
        />
      </QueryClientProvider>
    );

    expect(
      view.getByTitle(
        "Now playing on Example Radio: Current Show · Host Name, Ambient"
      ).textContent
    ).toBe("Current Show · Host NameAmbient");
    fireEvent.click(
      view.getByRole("button", { name: "Details for Current Show" })
    );
    expect(view.getByRole("dialog", { name: "Current Show" })).toBeTruthy();
    expect(view.getByText("Current show description.")).toBeTruthy();
  });

  test("makes the same show details available from an idle Station node", () => {
    const client = new QueryClient();
    client.setQueryData(
      radioMetadataKeys.stream(radio.streamUrl, radio.metadataConfig),
      {
        data: metadata,
        ok: true,
      }
    );
    const view = render(
      <QueryClientProvider client={client}>
        <StationNodeBody
          error={null}
          isLoading={false}
          isPlaying={false}
          muted
          onSelectDiscovered={noop}
          onSelectLocal={noop}
          onToggleMute={noop}
          onTogglePlayPause={noop}
          onVolumeChange={noop}
          radio={radio}
          radios={[radio]}
          volume={0}
        />
      </QueryClientProvider>
    );
    expect(view.getByRole("heading", { name: "Current Show" })).toBeTruthy();
    fireEvent.click(
      view.getByRole("button", { name: "Details for Current Show" })
    );
    expect(view.getByText("Current show description.")).toBeTruthy();
  });
});
