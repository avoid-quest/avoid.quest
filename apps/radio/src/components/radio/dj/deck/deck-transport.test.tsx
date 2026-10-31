import { beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RadioNowPlaying } from "@/lib/metadata/types";
import { type DeckContextValue, DeckProvider } from "./deck-context";
import { DeckTransport } from "./deck-transport";

const LONG_TITLE =
  "ARSIDER VIDEOCHAT #2 original super long station title with no predictable length";

const radio = {
  name: LONG_TITLE,
  streamUrl: "https://example.com/stream",
};

const deckContext: DeckContextValue = {
  addEffect: () => undefined,
  autoplay: false,
  channelFilter: 0,
  currentTrackIndex: 0,
  deckId: "deck-a",
  deckSide: "left",
  effects: [],
  effectsDryWet: 0,
  effectsTempo: 120,
  hasTracklist: false,
  isBuffering: false,
  isFileSource: false,
  isLoading: false,
  isPlaying: false,
  loadTrack: async (_streamUrl: string) => undefined,
  metadata: undefined,
  pan: 0,
  pause: () => undefined,
  play: async () => undefined,
  radio,
  removeEffect: () => undefined,
  reorderEffects: () => undefined,
  repeat: false,
  reset: async () => undefined,
  resetEffect: () => undefined,
  seek: () => undefined,
  setAutoplay: () => undefined,
  setChannelFilter: () => undefined,
  setEffectsDryWet: () => undefined,
  setEffectsTempo: () => undefined,
  setPan: () => undefined,
  setRepeat: () => undefined,
  setSpeed: () => undefined,
  setVolume: () => undefined,
  soundId: null,
  speed: 1,
  tracks: undefined,
  updateEffect: () => undefined,
  visible: true,
  volume: 1,
};

function renderTransport(nowPlaying?: RadioNowPlaying) {
  return renderToStaticMarkup(
    <DeckProvider value={deckContext}>
      <DeckTransport nowPlaying={nowPlaying} />
    </DeckProvider>
  );
}

describe("DeckTransport", () => {
  beforeEach(() => {
    deckContext.metadata = undefined;
    deckContext.deckSide = "left";
    deckContext.isPlaying = false;
    deckContext.isLoading = false;
  });

  test("keeps long station titles constrained and offers full details", () => {
    const html = renderTransport();

    expect(html.includes("block truncate")).toBeTrue();
    expect(html.includes(`title="${LONG_TITLE}"`)).toBeTrue();
    expect(html.includes(`Details for ${LONG_TITLE}`)).toBeTrue();
  });

  test("preserves the existing file transport and progress layout", () => {
    deckContext.metadata = {
      displayName: LONG_TITLE,
      duration: 100,
      fileName: "track.mp3",
      fileSize: 1000,
      isLocal: true,
      itemType: "track",
      mimeType: "audio/mpeg",
      platform: "static-audio",
      streamUrl: "blob:track",
      url: "",
    };
    const html = renderTransport();

    expect(
      html.includes("flex-1 flex-col justify-center gap-0.5 overflow-hidden")
    ).toBeTrue();
    expect(html.includes("block w-full truncate")).toBeTrue();
    expect(html.includes(`title="${LONG_TITLE}"`)).toBeTrue();
    expect(html.includes("Details for")).toBeFalse();
  });

  test("marks active radio transports with a border, not a playback badge", () => {
    deckContext.isPlaying = true;
    const playing = renderTransport();
    expect(playing.includes("border-foreground/40")).toBeTrue();
    expect(playing.includes(">Now playing<")).toBeFalse();
    expect(playing.includes(">Ready<")).toBeFalse();

    deckContext.isLoading = true;
    const connecting = renderTransport();
    expect(connecting.includes("border-foreground/40")).toBeFalse();
    expect(connecting.includes("Connecting…")).toBeTrue();

    deckContext.isPlaying = false;
    deckContext.isLoading = false;
    const paused = renderTransport();
    expect(paused.includes("border-foreground/40")).toBeFalse();
    expect(paused.includes("Connecting…")).toBeFalse();
  });

  test("keeps both playing decks out of live announcements", () => {
    deckContext.isPlaying = true;
    const decks = (["left", "right"] as const).map((side) => {
      deckContext.deckSide = side;
      return renderTransport();
    });
    expect(decks.join("").includes("aria-live")).toBeFalse();
  });

  for (const side of ["left", "right"] as const) {
    test(`shows current radio metadata inside the ${side} transport`, () => {
      deckContext.deckSide = side;
      const nowPlaying: RadioNowPlaying = {
        album: null,
        artist: "Current Host",
        artworkUrl: "https://example.com/show.jpg",
        bitrate: null,
        expiresAt: 2000,
        genre: "Ambient",
        itemUrl: "https://example.com/show",
        rawTitle: "Current Host - Current Show",
        sampledAt: 1000,
        source: "icy",
        stationDescription: "Current description",
        stationName: LONG_TITLE,
        streamUrl: radio.streamUrl,
        title: "Current Show",
      };
      const html = renderTransport(nowPlaying);
      expect(html.includes("Current Host")).toBeTrue();
      expect(html.includes("Details for Current Show")).toBeTrue();
      expect(html.includes('src="https://example.com/show.jpg"')).toBeTrue();
      expect(html.includes('href="https://example.com/show"')).toBeTrue();
      expect(html.includes('aria-label="Play deck A"')).toBeTrue();
    });
  }
});
