import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import { radioMetadataKeys } from "@/lib/hooks/use-radio-metadata";
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
let MultipleRadioCard: typeof import("./multiple/multiple-radio-card")["MultipleRadioCard"];
let StationList: typeof import("./single/single-player-station-list")["StationList"];

beforeAll(async () => {
  ({ RadioNowPlaying } = await import("./radio-now-playing"));
  ({ NowPlayingPanel } = await import("./single/single-player-now-playing"));
  ({ MultipleRadioCard } = await import("./multiple/multiple-radio-card"));
  ({ StationList } = await import("./single/single-player-station-list"));
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

describe("RadioNowPlaying", () => {
  for (const variant of ["featured", "compact"] as const) {
    test(`attaches player genres to featured artwork and keeps full Details in ${variant} mode`, () => {
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
      const playerGenres = view.queryByRole("list", { name: "Genres" });
      if (variant === "featured") {
        const artworkButton = view.getByRole("button", {
          name: "Details for Current Show",
        });
        expect(artworkButton.parentElement?.contains(playerGenres)).toBe(true);
        expect(artworkButton.querySelector("ul")).toBeNull();
        expect(
          view.getByText("Host Name").parentElement?.contains(playerGenres)
        ).toBe(false);
        expect(view.getByText("2 more genres in Details")).toBeTruthy();
        expect(view.getByText("Example Radio").nextElementSibling).toBe(
          view.getByRole("heading", { name: "Current Show" })
        );
      } else {
        expect(playerGenres).toBeNull();
        expect(
          view.getByLabelText("Genres: Art Pop, Downtempo, R&B / Soul")
            .textContent
        ).toBe("Art Pop+2");
      }

      fireEvent.click(
        view.getByRole("button", { name: "Details for Current Show" })
      );
      const details = within(view.getByRole("dialog"));
      const genres = details.getByRole("list", { name: "Genres" });
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
      expect(view.queryByRole("list", { name: "Genres" })).toBeNull();
      fireEvent.click(
        view.getByRole("button", { name: "Details for Current Show" })
      );
      expect(
        within(view.getByRole("dialog")).queryByRole("list", { name: "Genres" })
      ).toBeNull();
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

  test("keeps broadcast and station information together without dropping either description", () => {
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
    expect(details.getByText("Current show description.")).toBeTruthy();
    expect(details.getByText("Static station description.")).toBeTruthy();
    expect(details.getByText("Berlin, Germany")).toBeTruthy();
    expect(
      details
        .getByRole("link", { name: "Station website" })
        .getAttribute("href")
    ).toBe("https://radio.example/");
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

  test("does not repeat identical descriptions or render unsafe station links", () => {
    const view = render(
      <RadioNowPlaying
        metadata={{
          ...metadata,
          stationDescription: "Static station description.",
        }}
        radio={{ ...radio, websiteUrl: "javascript:alert(1)" }}
      />
    );
    fireEvent.click(
      view.getByRole("button", { name: "Details for Current Show" })
    );
    const details = within(view.getByRole("dialog"));
    expect(details.getAllByText("Static station description.")).toHaveLength(1);
    expect(
      details.queryByRole("heading", { name: "About this broadcast" })
    ).toBeNull();
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
          onDelete={noop}
          onEdit={noop}
          onSave={noop}
          onSelect={noop}
          onToggle={noop}
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

  test("makes the same show details available from an idle Multiple card", () => {
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
        <MultipleRadioCard
          onToggleMute={noop}
          onTogglePlayPause={noop}
          onVolumeChange={noop}
          playerState={{
            error: null,
            id: "test-radio",
            isLoading: false,
            isMuted: true,
            isPlaying: false,
            radio,
            volume: 0,
          }}
          radio={radio}
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
