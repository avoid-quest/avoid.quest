import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Radio } from "../playback/types";
import {
  clearAudioDebugSources,
  getAudioDebugSnapshot,
  recordAudioDebugEvent,
  registerAudioDebugSource,
} from "./audio-debug-store";

const radio: Radio = {
  id: "resonance-extra",
  name: "Resonance Extra",
  streamUrl: "https://stream.resonance.fm/resonance-extra",
};

const originalDateNow = Date.now;
let now = 0;

function createElement(): Pick<
  HTMLMediaElement,
  | "buffered"
  | "currentSrc"
  | "currentTime"
  | "crossOrigin"
  | "networkState"
  | "readyState"
> {
  return {
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 12,
    } as TimeRanges,
    currentSrc: radio.streamUrl,
    currentTime: 4,
    crossOrigin: "anonymous",
    networkState: 2,
    readyState: 3,
  };
}

beforeEach(() => {
  now = 0;
  Date.now = () => now;
  clearAudioDebugSources();
});

afterEach(() => {
  Date.now = originalDateNow;
  clearAudioDebugSources();
});

describe("audio debug store", () => {
  test("aggregates buffering duration and activity gaps", () => {
    const id = "debug-store-test";
    const element = createElement();

    registerAudioDebugSource({
      id,
      mode: "single",
      radio,
      streamUrl: radio.streamUrl,
      loadMode: "cors-anonymous",
      deliveryPath: "direct",
      processingPath: "html5",
    });

    recordAudioDebugEvent(id, "canplay", {
      element,
      streamUrl: radio.streamUrl,
    });
    now = 150;
    recordAudioDebugEvent(id, "waiting", {
      element,
      streamUrl: radio.streamUrl,
    });
    now = 420;
    recordAudioDebugEvent(id, "progress", {
      element,
      streamUrl: radio.streamUrl,
    });
    now = 860;
    recordAudioDebugEvent(id, "playing", {
      element,
      streamUrl: radio.streamUrl,
    });

    const snapshot = getAudioDebugSnapshot(id);
    expect(snapshot).toBeDefined();
    expect(snapshot?.totalBufferingMs).toBe(270);
    expect(snapshot?.maxGapMs).toBe(440);
    expect(snapshot?.bufferedAheadSec).toBe(8);
    expect(snapshot?.eventCounts.waiting).toBe(1);
    expect(snapshot?.eventCounts.progress).toBe(1);
  });
});
