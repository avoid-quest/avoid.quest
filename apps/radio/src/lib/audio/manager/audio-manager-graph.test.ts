import { describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  attachWorkletManagerListeners,
  cleanupSoundNodes,
  connectAudioGraph,
} from "./audio-manager-graph";
import type { SoundInstance } from "./audio-manager-types";

type WorkletEventHandlers = Record<string, (payload: unknown) => void>;

function createTestSoundInstance(radio: Radio): SoundInstance {
  return {
    radio,
    sourceId: "sound-1",
    volume: 1,
    playing: true,
    loading: false,
    buffering: false,
    nodes: null,
    playbackSource: null,
    deviceSource: null,
    unsubscribe: null,
    meterUnsubscribe: null,
    isDeviceInput: false,
  } as unknown as SoundInstance;
}

class TestAudioNode {
  readonly outputs = new Set<TestAudioNode>();

  connect(destination: TestAudioNode): TestAudioNode {
    this.outputs.add(destination);
    return destination;
  }

  disconnect(destination?: TestAudioNode): void {
    if (destination) {
      this.outputs.delete(destination);
    } else {
      this.outputs.clear();
    }
  }
}

function attachTestWorkletListeners() {
  const handlers: WorkletEventHandlers = {};
  const notifyListeners = mock(
    (_soundId: string, _state: unknown) => undefined
  );

  attachWorkletManagerListeners({
    wm: {
      on: mock((event: string, callback: (payload: unknown) => void) => {
        handlers[event] = callback;
      }),
    } as never,
    sounds: new Map([
      [
        "sound-1",
        createTestSoundInstance({
          id: "station-1",
          name: "Station 1",
          streamUrl: "https://radio.example/one.mp3",
        }),
      ],
    ]),
    notifyListeners,
  });

  return { handlers, notifyListeners };
}

describe("audio manager graph worklet errors", () => {
  test.each([
    "pause",
    "resume",
  ])("does not surface stale worklet SOURCE_NOT_FOUND from %s cleanup", (action) => {
    const { handlers, notifyListeners } = attachTestWorkletListeners();
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      handlers.sourceError?.({
        id: "err-1",
        sourceId: "sound-1",
        error: `Cannot ${action}: source sound-1 not found`,
        code: "SOURCE_NOT_FOUND",
        timestamp: 123,
      });

      expect(notifyListeners).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        `[AudioManager] Ignoring stale worklet source error: Cannot ${action}: source sound-1 not found`
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  test("surfaces non-pause SOURCE_NOT_FOUND worklet errors", () => {
    const { handlers, notifyListeners } = attachTestWorkletListeners();

    handlers.sourceError?.({
      id: "err-1",
      sourceId: "sound-1",
      error: "Cannot start: source sound-1 not found",
      code: "SOURCE_NOT_FOUND",
      timestamp: 123,
    });

    expect(notifyListeners).toHaveBeenCalledWith(
      "sound-1",
      expect.objectContaining({
        error: expect.objectContaining({
          code: "PLAYBACK_FAILED",
          message: "Cannot start: source sound-1 not found",
        }),
      })
    );
  });
});

describe("audio manager output registration", () => {
  test("keeps mono device input mono until openDAW, then pans its return", async () => {
    const filter = new TestAudioNode();
    const gain = new TestAudioNode();
    const pan = new TestAudioNode();
    const preFaderSend = new TestAudioNode();
    const sourceOutput = new TestAudioNode();
    const connectEffectsGraph = mock(async () => true);
    const instance = {
      ...createTestSoundInstance({
        id: "microphone",
        name: "Microphone",
        streamUrl: "device://microphone",
      }),
      deviceSource: { channelCount: 1, output: sourceOutput },
      isDeviceInput: true,
      nodes: { filter, gain, pan, preFaderSend },
    } as unknown as SoundInstance;

    await connectAudioGraph({
      instance,
      connectEffectsGraph,
      connectMainOutput: () => () => undefined,
      notifyListeners: () => undefined,
    });

    expect(sourceOutput.outputs.has(filter)).toBe(true);
    expect(connectEffectsGraph).toHaveBeenCalledWith("sound-1", filter, pan, 1);
    expect(pan.outputs.has(preFaderSend)).toBe(true);
  });

  test("preserves a registered CUE connection when rebuilding a sound graph", async () => {
    const cueOutput = new TestAudioNode();
    const filter = new TestAudioNode();
    const gain = new TestAudioNode();
    const pan = new TestAudioNode();
    const preFaderSend = new TestAudioNode();
    const sourceOutput = new TestAudioNode();
    const connectEffectsGraph = mock(async () => true);
    preFaderSend.connect(cueOutput);
    const instance = {
      ...createTestSoundInstance({
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      }),
      nodes: { filter, gain, pan, preFaderSend },
      playbackSource: { output: sourceOutput },
    } as unknown as SoundInstance;

    await connectAudioGraph({
      instance,
      connectEffectsGraph,
      connectMainOutput: () => () => undefined,
      notifyListeners: () => undefined,
    });

    expect(preFaderSend.outputs.has(cueOutput)).toBe(true);
    expect(preFaderSend.outputs.has(gain)).toBe(true);
    expect(sourceOutput.outputs.has(pan)).toBe(true);
    expect(pan.outputs.has(filter)).toBe(true);
    expect(connectEffectsGraph).toHaveBeenCalledWith(
      "sound-1",
      filter,
      preFaderSend,
      2
    );
  });

  test("releases the main output registration when sound nodes are cleaned", () => {
    const releaseMainOutput = mock(() => undefined);
    const instance = {
      ...createTestSoundInstance({
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      }),
      mainOutputCleanup: releaseMainOutput,
      nodes: {
        filter: { disconnect: mock(() => undefined) },
        gain: { disconnect: mock(() => undefined) },
        pan: { disconnect: mock(() => undefined) },
        preFaderSend: { disconnect: mock(() => undefined) },
      },
    } as unknown as SoundInstance;

    cleanupSoundNodes(instance);

    expect(releaseMainOutput).toHaveBeenCalledTimes(1);
    expect(instance.mainOutputCleanup).toBeNull();
  });
});
