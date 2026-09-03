import { beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const LONG_TITLE =
  "ARSIDER VIDEOCHAT #2 original super long station title with no predictable length";

const deckContextMock = {
  addEffect: () => undefined,
  autoplay: false,
  channelFilter: 0,
  currentTrackIndex: 0,
  deckId: "deck-a" as const,
  deckSide: "left" as const,
  effects: [],
  effectsDryWet: 0,
  hasTracklist: false,
  isBuffering: false,
  isFileSource: false,
  isLoading: false,
  isPlaying: false,
  isSeekable: false,
  loadTrack: async (_streamUrl: string) => undefined,
  metadata: undefined,
  pan: 0,
  pause: () => undefined,
  peakLevel: { left: 0, right: 0 },
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
