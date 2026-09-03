import { beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const LONG_TITLE =
  "ARSIDER VIDEOCHAT #2 original super long station title with no predictable length";

const deckContextMock = {
  deckId: "deck-a" as const,
  deckSide: "left" as const,
  radio: {
    name: LONG_TITLE,
    streamUrl: "https://example.com/stream",
  },
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
  volume: 1,
  pan: 0,
  speed: 1,
  channelFilter: 0,
  effectsDryWet: 0,
  effects: [],
  repeat: false,
  autoplay: false,
  soundId: null,
  play: async () => undefined,
  pause: () => undefined,
  setVolume: () => undefined,
  setPan: () => undefined,
  setSpeed: () => undefined,
  setChannelFilter: () => undefined,
  setEffectsDryWet: () => undefined,
  setRepeat: () => undefined,
  setAutoplay: () => undefined,
  seek: () => undefined,
  loadTrack: async (_streamUrl: string) => undefined,
  reset: async () => undefined,
  addEffect: () => undefined,
  updateEffect: () => undefined,
  removeEffect: () => undefined,
  reorderEffects: () => undefined,
  trackProgress: undefined,
  peakLevel: { left: 0, right: 0 },
  metadata: undefined,
  currentTrackIndex: 0,
  hasTracklist: false,
  tracks: undefined,
  isFileSource: false,
  isSeekable: false,
};

mock.module("./deck-context", () => ({
  useDeckContext: () => deckContextMock,
}));

let DeckTransport: typeof import("./deck-transport")["DeckTransport"];

beforeAll(async () => {
  ({ DeckTransport } = await import("./deck-transport"));
});

describe("DeckTransport", () => {
  test("keeps long titles constrained to one truncated line", () => {
    const html = renderToStaticMarkup(<DeckTransport />);

    expect(
      html.includes("flex-1 flex-col justify-center gap-0.5 overflow-hidden")
    ).toBeTrue();
    expect(html.includes("block w-full")).toBeTrue();
    expect(html.includes("overflow-hidden")).toBeTrue();
    expect(html.includes("text-ellipsis")).toBeTrue();
    expect(html.includes("whitespace-nowrap")).toBeTrue();
    expect(html.includes(`title="${LONG_TITLE}"`)).toBeTrue();
  });
});
