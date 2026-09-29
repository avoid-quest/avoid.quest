import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RadioNowPlaying } from "@/lib/metadata/types";
import type { PlatformMetadata } from "@/lib/platform-types";

const LONG_TITLE =
  "ARSIDER VIDEOCHAT #2 original super long station title with no predictable length";

const deckContextMock = {
  addEffect: () => undefined,
  autoplay: false,
  channelFilter: 0,
  currentTrackIndex: 0,
  deckId: "deck-a" as const,
  deckSide: "left" as "left" | "right",
  effects: [],
  effectsDryWet: 0,
  hasTracklist: false,
  isBuffering: false,
  isFileSource: false,
  isLoading: false,
  isPlaying: false,
  isSeekable: false,
  loadTrack: async (_streamUrl: string) => undefined,
  metadata: undefined as PlatformMetadata | undefined,
  pan: 0,
  pause: () => undefined,
  play: async () => undefined,
  radio: {
    name: LONG_TITLE,
    streamUrl: "https://example.com/stream",
  },
  removeEffect: () => undefined,
  reorderEffects: () => undefined,
  repeat: false,
  reset: async () => undefined,
  seek: () => undefined,
  setAutoplay: () => undefined,
  setChannelFilter: () => undefined,
  setEffectsDryWet: () => undefined,
  setPan: () => undefined,
  setRepeat: () => undefined,
  setSpeed: () => undefined,
  setVolume: () => undefined,
  soundId: null,
  speed: 1,
  trackProgress: undefined,
  tracks: undefined,
  updateEffect: () => undefined,
  volume: 1,
};

mock.module("./deck-context", () => ({
  useDeckContext: () => deckContextMock,
}));

let DeckTransport: typeof import("./deck-transport")["DeckTransport"];

beforeAll(async () => {
  ({ DeckTransport } = await import("./deck-transport"));
});

describe("DeckTransport", () => {
  beforeEach(() => {
    deckContextMock.metadata = undefined;
    deckContextMock.deckSide = "left";
    deckContextMock.isPlaying = false;
    deckContextMock.isLoading = false;
  });

  test("keeps long station titles constrained and offers full details", () => {
    const html = renderToStaticMarkup(<DeckTransport />);

    expect(html.includes("block truncate")).toBeTrue();
    expect(html.includes(`title="${LONG_TITLE}"`)).toBeTrue();
    expect(html.includes(`Details for ${LONG_TITLE}`)).toBeTrue();
  });

  test("preserves the existing file transport and progress layout", () => {
    deckContextMock.metadata = {
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
    const html = renderToStaticMarkup(<DeckTransport />);

    expect(
      html.includes("flex-1 flex-col justify-center gap-0.5 overflow-hidden")
    ).toBeTrue();
    expect(html.includes("block w-full truncate")).toBeTrue();
    expect(html.includes(`title="${LONG_TITLE}"`)).toBeTrue();
    expect(html.includes("Details for")).toBeFalse();
  });

  test("marks active radio transports with a border, not a playback badge", () => {
    deckContextMock.isPlaying = true;
    const playing = renderToStaticMarkup(<DeckTransport />);
    expect(playing.includes("border-foreground/40")).toBeTrue();
    expect(playing.includes(">Now playing<")).toBeFalse();
    expect(playing.includes(">Ready<")).toBeFalse();

    deckContextMock.isLoading = true;
    const connecting = renderToStaticMarkup(<DeckTransport />);
    expect(connecting.includes("border-foreground/40")).toBeFalse();
    expect(connecting.includes("Connecting…")).toBeTrue();

    deckContextMock.isPlaying = false;
    deckContextMock.isLoading = false;
    const paused = renderToStaticMarkup(<DeckTransport />);
    expect(paused.includes("border-foreground/40")).toBeFalse();
    expect(paused.includes("Connecting…")).toBeFalse();
  });

  for (const side of ["left", "right"] as const) {
    test(`shows current radio metadata inside the ${side} transport`, () => {
      deckContextMock.deckSide = side;
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
        streamUrl: deckContextMock.radio.streamUrl,
        title: "Current Show",
      };
      const html = renderToStaticMarkup(
        <DeckTransport nowPlaying={nowPlaying} />
      );
      expect(html.includes("Current Host")).toBeTrue();
      expect(html.includes("Details for Current Show")).toBeTrue();
      expect(html.includes('src="https://example.com/show.jpg"')).toBeTrue();
      expect(html.includes('href="https://example.com/show"')).toBeTrue();
      expect(html.includes('aria-label="Play deck A"')).toBeTrue();
    });
  }
});
