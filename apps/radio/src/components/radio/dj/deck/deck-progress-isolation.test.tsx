import { expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { AudioManager } from "@/lib/audio";
import { installAnimationTestEnvironment } from "../shared/animation-test-utils";
import { DeckChannelStrip } from "./deck-channel-strip";
import { type DeckContextValue, DeckProvider } from "./deck-context";
import { DeckTracklist } from "./deck-tracklist";
import { DeckTransport } from "./deck-transport";

const ignore = () => undefined;
const resolve = () => Promise.resolve();

function context(): DeckContextValue {
  return {
    addEffect: ignore,
    autoplay: false,
    channelFilter: 0,
    currentTrackIndex: 0,
    deckId: "deck-a",
    deckSide: "left",
    effects: [],
    effectsDryWet: 1,
    effectsTempo: 120,
    hasTracklist: true,
    isBuffering: false,
    isFileSource: true,
    isLoading: false,
    isPlaying: true,
    loadTrack: resolve,
    metadata: {
      displayName: "Track",
      duration: 100,
      fileName: "track.mp3",
      fileSize: 1000,
      isLocal: false,
      itemType: "track",
      mimeType: "audio/mpeg",
      platform: "static-audio",
      streamUrl: "https://audio.example/track.mp3",
      url: "https://audio.example/track.mp3",
    },
    pan: 0,
    pause: ignore,
    play: resolve,
    radio: { name: "Track", streamUrl: "https://audio.example/track.mp3" },
    removeEffect: ignore,
    reorderEffects: ignore,
    repeat: false,
    reset: resolve,
    resetEffect: ignore,
    seek: ignore,
    setAutoplay: ignore,
    setChannelFilter: ignore,
    setEffectsDryWet: ignore,
    setEffectsTempo: ignore,
    setPan: ignore,
    setRepeat: ignore,
    setSpeed: ignore,
    setVolume: ignore,
    soundId: "isolation",
    speed: 1,
    tracks: [],
    updateEffect: ignore,
    visible: true,
    volume: 1,
  };
}

test("progress commits stay inside the transport and leave strip and tracklist idle", () => {
  const clock = installAnimationTestEnvironment();
  const sample = spyOn(
    AudioManager.getInstance(),
    "getTrackProgress"
  ).mockReturnValue({ duration: 100, position: 0 });
  const transport = mock(ignore);
  const strip = mock(ignore);
  const tracklist = mock(ignore);
  try {
    render(
      <DeckProvider value={context()}>
        <Profiler id="transport" onRender={transport}>
          <DeckTransport />
        </Profiler>
        <Profiler id="strip" onRender={strip}>
          <DeckChannelStrip />
        </Profiler>
        <Profiler id="tracklist" onRender={tracklist}>
          <DeckTracklist />
        </Profiler>
      </DeckProvider>
    );
    const stripCommits = strip.mock.calls.length;
    const tracklistCommits = tracklist.mock.calls.length;
    const transportCommits = transport.mock.calls.length;
    for (let position = 1; position <= 8; position += 1) {
      sample.mockReturnValue({ duration: 100, position });
      act(() => clock.advance(250));
    }
    expect(transport.mock.calls.length).toBeGreaterThan(transportCommits);
    expect(strip.mock.calls.length).toBe(stripCommits);
    expect(tracklist.mock.calls.length).toBe(tracklistCommits);
  } finally {
    cleanup();
    sample.mockRestore();
    clock.restore();
  }
});
