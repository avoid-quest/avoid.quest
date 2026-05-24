type WorkletPortMessage = {
  type: string;
  payload?: unknown;
};

type InstalledGlobal = {
  key: keyof typeof globalThis;
  value: unknown;
};

type Listener = {
  callback: EventListener;
  once: boolean;
};

type HarnessRecords = {
  animationFrames: Map<number, FrameRequestCallback>;
  connections: string[];
  disconnections: string[];
  events: string[];
  loadedUrls: string[];
  nextAnimationFrameId: number;
  workletMessages: WorkletPortMessage[];
  workletModules: string[];
};

type HarnessOptions = {
  analyserSample?: number;
  failWorkletModule?: boolean;
};

type AudioEngineLifecycleHarness = ReturnType<
  typeof installAudioEngineLifecycleHarness
>;

/**
 * Local browser-audio substitute for audio engine lifecycle tests.
 *
 * Keep this harness behavior-focused: it supplies just enough browser audio,
 * media element, graph, and worklet surface for AudioManager to run one real
 * lifecycle locally. Future lifecycle slices should extend this harness only
 * when they need another observable browser boundary, not to mock AudioManager
 * internals or replace the engine implementation.
 */
function installAudioEngineLifecycleHarness(options: HarnessOptions = {}) {
  const records: HarnessRecords = {
    animationFrames: new Map(),
    connections: [],
    disconnections: [],
    events: [],
    loadedUrls: [],
    nextAnimationFrameId: 1,
    workletMessages: [],
    workletModules: [],
  };
  const originals = installGlobals(records, options);

  return {
    connectedNodePairs: () => [...records.connections],
    disconnectedNodeNames: () => [...records.disconnections],
    events: () => [...records.events],
    loadedMediaUrls: () => [...records.loadedUrls],
    restore: () => restoreGlobals(originals),
    runAnimationFrames: (count = 1) => {
      for (let i = 0; i < count; i++) {
        const [id, callback] =
          records.animationFrames.entries().next().value ?? [];
        if (!(id && callback)) {
          return;
        }
        records.animationFrames.delete(id);
        callback(performance.now());
      }
    },
    workletMessages: () => [...records.workletMessages],
    workletModules: () => [...records.workletModules],
  };
}

function installGlobals(
  records: HarnessRecords,
  options: HarnessOptions
): InstalledGlobal[] {
  const originals: InstalledGlobal[] = [];

  const assignGlobal = (key: keyof typeof globalThis, value: unknown): void => {
    originals.push({ key, value: globalThis[key] });
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  };

  class FakeAudioParam {
    value = 1;

    cancelAndHoldAtTime(_time: number): void {
      // Fake params do not schedule automation curves.
    }
    cancelScheduledValues(_time: number): void {
      // Fake params do not schedule automation curves.
    }
    exponentialRampToValueAtTime(value: number, _endTime: number): void {
      this.value = value;
    }
    setTargetAtTime(
      value: number,
      _startTime: number,
      _timeConstant: number
    ): void {
      this.value = value;
    }
    setValueAtTime(value: number, _time: number): void {
      this.value = value;
    }
    setValueCurveAtTime(
      values: Float32Array,
      _time: number,
      _duration: number
    ): void {
      this.value = values.at(-1) ?? this.value;
    }
  }

  class FakeAudioNode {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    connect(destination: FakeAudioNode): FakeAudioNode {
      records.connections.push(`${this.name} -> ${destination.name}`);
      return destination;
    }

    disconnect(): void {
      records.disconnections.push(this.name);
    }
  }

  class FakeGainNode extends FakeAudioNode {
    readonly gain = new FakeAudioParam();

    constructor(name = "gain") {
      super(name);
    }
  }

  class FakeStereoPannerNode extends FakeAudioNode {
    readonly pan = new FakeAudioParam();

    constructor() {
      super("stereo-panner");
    }
  }

  class FakeBiquadFilterNode extends FakeAudioNode {
    readonly frequency = new FakeAudioParam();
    readonly Q = new FakeAudioParam();
    readonly gain = new FakeAudioParam();
    type = "allpass";

    constructor() {
      super("biquad");
    }
  }

  class FakeAnalyserNode extends FakeAudioNode {
    fftSize = 2048;
    smoothingTimeConstant = 0.8;

    constructor(name = "analyser") {
      super(name);
    }

    getFloatTimeDomainData(buffer: Float32Array): void {
      buffer.fill(options.analyserSample ?? 0);
    }
  }

  class FakeAudioContext {
    readonly audioWorklet = {
      addModule: (url: string): Promise<void> => {
        records.events.push(`worklet-module:${url}`);
        records.workletModules.push(url);
        if (options.failWorkletModule) {
          return Promise.reject(new Error("Worklet module failed"));
        }
        return Promise.resolve();
      },
    };
    currentTime = 0;
    readonly destination = new FakeAudioNode("destination");
    sampleRate = 44_100;
    state = "running";
    onstatechange: (() => void) | null = null;
    private gainCount = 0;

    close(): Promise<void> {
      this.state = "closed";
      this.onstatechange?.();
      return Promise.resolve();
    }

    createAnalyser(): FakeAnalyserNode {
      return new FakeAnalyserNode();
    }

    createBiquadFilter(): FakeBiquadFilterNode {
      return new FakeBiquadFilterNode();
    }

    createChannelSplitter(_channels: number): FakeAudioNode {
      return new FakeAudioNode("channel-splitter");
    }

    createDelay(_maxDelayTime?: number): FakeAudioNode & {
      delayTime: FakeAudioParam;
    } {
      return Object.assign(new FakeAudioNode("delay"), {
        delayTime: new FakeAudioParam(),
      });
    }

    createGain(): FakeGainNode {
      this.gainCount += 1;
      return new FakeGainNode(this.gainCount === 4 ? "worklet-gain" : "gain");
    }

    createMediaElementSource(_audio: FakeAudioElement): FakeAudioNode {
      return new FakeAudioNode("media-source");
    }

    createStereoPanner(): FakeStereoPannerNode {
      return new FakeStereoPannerNode();
    }

    resume(): Promise<void> {
      this.state = "running";
      this.onstatechange?.();
      return Promise.resolve();
    }

    suspend(): Promise<void> {
      this.state = "suspended";
      this.onstatechange?.();
      return Promise.resolve();
    }
  }

  class FakeAudioWorkletNode extends FakeAudioNode {
    readonly port = {
      onmessage: null as
        | ((event: MessageEvent<WorkletPortMessage>) => void)
        | null,
      postMessage: (message: WorkletPortMessage) => {
        records.workletMessages.push(message);
      },
    };

    constructor(
      _context: AudioContext,
      _name: string,
      _options?: AudioWorkletNodeOptions
    ) {
      super("worklet");
    }
  }

  class FakeAudioElement {
    autoplay = false;
    crossOrigin = "";
    currentTime = 0;
    duration = Number.POSITIVE_INFINITY;
    error: MediaError | null = null;
    paused = true;
    playbackRate = 1;
    preload = "";
    readyState = 0;
    src = "";
    private readonly listeners = new Map<string, Listener[]>();

    addEventListener(
      type: string,
      callback: EventListener,
      options?: AddEventListenerOptions | boolean
    ): void {
      const once =
        typeof options === "object" && options !== null
          ? !!options.once
          : false;
      const listeners = this.listeners.get(type) ?? [];
      listeners.push({ callback, once });
      this.listeners.set(type, listeners);
    }

    canPlayType(_type: string): CanPlayTypeResult {
      return "";
    }

    load(): void {
      if (!this.src) {
        this.readyState = 0;
        return;
      }

      records.loadedUrls.push(this.src);
      records.events.push(`media-load:${this.src}`);
      this.readyState = 1;
      queueMicrotask(() => {
        this.dispatch("loadedmetadata");
      });
    }

    pause(): void {
      records.events.push("media-pause");
      this.paused = true;
      this.dispatch("pause");
    }

    play(): Promise<void> {
      records.events.push("media-play");
      this.paused = false;
      this.dispatch("playing");
      return Promise.resolve();
    }

    removeAttribute(name: string): void {
      if (name === "src") {
        this.src = "";
      }
    }

    removeEventListener(type: string, callback: EventListener): void {
      const listeners = this.listeners.get(type);
      if (!listeners) {
        return;
      }

      this.listeners.set(
        type,
        listeners.filter((listener) => listener.callback !== callback)
      );
    }

    setAttribute(_name: string, _value: string): void {
      // Attribute values are not observable in this lifecycle harness yet.
    }

    private dispatch(type: string): void {
      const listeners = this.listeners.get(type) ?? [];
      for (const listener of [...listeners]) {
        listener.callback(new Event(type));
      }
      this.listeners.set(
        type,
        listeners.filter((listener) => !listener.once)
      );
    }
  }

  assignGlobal("Audio", FakeAudioElement);
  assignGlobal("AudioContext", FakeAudioContext);
  assignGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  assignGlobal("cancelAnimationFrame", (id: number) => {
    records.animationFrames.delete(id);
  });
  assignGlobal("HTMLMediaElement", { HAVE_METADATA: 1 });
  assignGlobal("MediaError", {
    MEDIA_ERR_ABORTED: 1,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: 3,
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
  });
  assignGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = records.nextAnimationFrameId++;
    records.animationFrames.set(id, callback);
    return id;
  });

  return originals;
}

function restoreGlobals(originals: InstalledGlobal[]): void {
  for (const { key, value } of [...originals].reverse()) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
      continue;
    }

    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
}

export type { AudioEngineLifecycleHarness };
export { installAudioEngineLifecycleHarness };
