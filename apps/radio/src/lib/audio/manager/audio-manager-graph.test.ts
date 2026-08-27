import { describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  attachWorkletManagerListeners,
  cleanupSoundNodes,
  connectAudioGraph,
  updateDeviceChannelSelection,
} from "./audio-manager-graph";
import type { SoundInstance } from "./audio-manager-types";

type WorkletEventHandlers = Record<string, (payload: unknown) => void>;

function createTestSoundInstance(radio: Radio): SoundInstance {
  return {
    buffering: false,
    deviceSource: null,
    isDeviceInput: false,
    loading: false,
    meterUnsubscribe: null,
    nodes: null,
    playbackSource: null,
    playing: true,
    radio,
    sourceId: "sound-1",
    unsubscribe: null,
    volume: 1,
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

function createDeviceInputSelectionFixture(initialOutputChannelCount: 1 | 2) {
  let outputChannelCount = initialOutputChannelCount;
  const deviceSource = {
    isActive: true,
    get outputChannelCount() {
      return outputChannelCount;
    },
    setChannelSelection: mock((selection: { left: number; right: number }) => {
      outputChannelCount = selection.left === selection.right ? 1 : 2;
    }),
  };
  const instance = {
    deviceSource,
    nodes: {},
    sourceId: "sound-1",
  } as unknown as SoundInstance;
  const reconnectGraph = mock(async () => true);

  return { instance, reconnectGraph };
}

function attachTestWorkletListeners() {
  const handlers: WorkletEventHandlers = {};
  const notifyListeners = mock(
    (_soundId: string, _state: unknown) => undefined
  );

  attachWorkletManagerListeners({
    notifyListeners,
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
    wm: {
      on: mock((event: string, callback: (payload: unknown) => void) => {
        handlers[event] = callback;
      }),
    } as never,
  });

  return { handlers, notifyListeners };
}

describe("audio manager graph worklet errors", () => {
  test.each(["pause", "resume"])(
    "does not surface stale worklet SOURCE_NOT_FOUND from %s cleanup",
    (action) => {
      const { handlers, notifyListeners } = attachTestWorkletListeners();
      const originalWarn = console.warn;
      console.warn = mock(() => undefined);

      try {
        handlers.sourceError({
          code: "SOURCE_NOT_FOUND",
          error: `Cannot ${action}: source sound-1 not found`,
          id: "err-1",
          sourceId: "sound-1",
          timestamp: 123,
        });

        expect(notifyListeners).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(
          `[AudioManager] Ignoring stale worklet source error: Cannot ${action}: source sound-1 not found`
        );
      } finally {
        console.warn = originalWarn;
      }
    }
  );

  test("surfaces non-pause SOURCE_NOT_FOUND worklet errors", () => {
    const { handlers, notifyListeners } = attachTestWorkletListeners();

    handlers.sourceError({
      code: "SOURCE_NOT_FOUND",
      error: "Cannot start: source sound-1 not found",
      id: "err-1",
      sourceId: "sound-1",
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
  test("registers a mono selection from a stereo device as mono", async () => {
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
      deviceSource: {
        channelCount: 2,
        currentChannelSelection: { left: 0, right: 0 },
        output: sourceOutput,
        outputChannelCount: 1,
      },
      isDeviceInput: true,
      nodes: { filter, gain, pan, preFaderSend },
    } as unknown as SoundInstance;

    await connectAudioGraph({
      connectEffectsGraph,
      connectMainOutput: () => () => undefined,
      instance,
      notifyListeners: () => undefined,
    });

    expect(sourceOutput.outputs.has(filter)).toBe(true);
    expect(connectEffectsGraph).toHaveBeenCalledWith("sound-1", filter, pan, 1);
    expect(pan.outputs.has(preFaderSend)).toBe(true);
  });

  test("reconnects the effects graph when the selected width changes", () => {
    const { instance, reconnectGraph } = createDeviceInputSelectionFixture(2);

    updateDeviceChannelSelection({
      instance,
      reconnectGraph,
      selection: { left: 0, right: 0 },
    });
    expect(reconnectGraph).toHaveBeenCalledWith(instance);
  });

  test("does not reconnect for selections of the same width", () => {
    const { instance, reconnectGraph } = createDeviceInputSelectionFixture(1);

    updateDeviceChannelSelection({
      instance,
      reconnectGraph,
      selection: { left: 1, right: 1 },
    });
    expect(reconnectGraph).not.toHaveBeenCalled();
  });

  test("serializes device-width graph reconnects", async () => {
    const { instance } = createDeviceInputSelectionFixture(2);
    let finishFirst = (): void => undefined;
    const firstReconnect = new Promise<boolean>((resolve) => {
      finishFirst = () => resolve(true);
    });
    let reconnectCount = 0;
    const reconnectGraph = mock(() => {
      reconnectCount += 1;
      return reconnectCount === 1 ? firstReconnect : Promise.resolve(true);
    });

    updateDeviceChannelSelection({
      instance,
      reconnectGraph,
      selection: { left: 0, right: 0 },
    });
    updateDeviceChannelSelection({
      instance,
      reconnectGraph,
      selection: { left: 0, right: 1 },
    });

    expect(reconnectGraph).toHaveBeenCalledTimes(1);
    finishFirst();
    await firstReconnect;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(reconnectGraph).toHaveBeenCalledTimes(2);
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
      connectEffectsGraph,
      connectMainOutput: () => () => undefined,
      instance,
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
