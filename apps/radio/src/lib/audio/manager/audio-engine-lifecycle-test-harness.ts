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
  failMediaUrlIncludes?: string;
  failWorkletModule?: boolean;
  simulateWorkletSourceErrors?: boolean;
};

type AudioEngineLifecycleHarness = ReturnType<
  typeof installAudioEngineLifecycleHarness
>;

const HAVE_NOTHING = 0;
const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;

/** Browser-audio substitute for AudioManager lifecycle tests. */
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
      // Scheduling is intentionally not simulated by this lifecycle harness.
    }
    cancelScheduledValues(_time: number): void {
      // Scheduling is intentionally not simulated by this lifecycle harness.
    }
    exponentialRampToValueAtTime(value: number, _endTime: number): void {
      this.value = value;
    }
    linearRampToValueAtTime(value: number, _endTime: number): void {
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
    readonly context: BaseAudioContext;
    readonly name: string;

    constructor(name: string, context: unknown = {}) {
      this.context = context as BaseAudioContext;
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

    constructor(context: unknown, name = "gain") {
      super(name, context);
    }
  }

  class FakeStereoPannerNode extends FakeAudioNode {
    readonly pan = new FakeAudioParam();

    constructor(context: unknown) {
      super("stereo-panner", context);
    }
  }

  class FakeBiquadFilterNode extends FakeAudioNode {
    readonly frequency = new FakeAudioParam();
    readonly Q = new FakeAudioParam();
    readonly gain = new FakeAudioParam();
    type = "allpass";

    constructor(context: unknown) {
      super("biquad", context);
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
    readonly destination: FakeAudioNode = new FakeAudioNode(
      "destination",
      this
    );
    sampleRate = 44_100;
    state = "running";
    onstatechange: (() => void) | null = null;
    private gainCount = 0;

    close(): Promise<void> {
      this.state = "closed";
      this.onstatechange?.();
      return Promise.resolve();
    }

    createBiquadFilter(): FakeBiquadFilterNode {
      return new FakeBiquadFilterNode(this);
    }

    createChannelSplitter(_channels: number): FakeAudioNode {
      return new FakeAudioNode("channel-splitter", this);
    }

    createDelay(_maxDelayTime?: number): FakeAudioNode & {
      delayTime: FakeAudioParam;
    } {
      return Object.assign(new FakeAudioNode("delay", this), {
        delayTime: new FakeAudioParam(),
      });
    }

    createGain(): FakeGainNode {
      this.gainCount += 1;
      return new FakeGainNode(
        this,
        this.gainCount === 4 ? "worklet-gain" : "gain"
      );
    }

    createMediaElementSource(_audio: FakeAudioElement): FakeAudioNode {
      return new FakeAudioNode("media-source", this);
    }

    createStereoPanner(): FakeStereoPannerNode {
      return new FakeStereoPannerNode(this);
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
    private readonly sources = new Set<string>();
    readonly port = {
      onmessage: null as
        | ((event: MessageEvent<WorkletPortMessage>) => void)
        | null,
      postMessage: (message: WorkletPortMessage) => {
        records.workletMessages.push(message);
        const payload = message.payload as
          | { effectId?: string; id?: string; sourceId?: string }
          | undefined;
        if (message.type === "CREATE_SOURCE" && payload?.id) {
          this.sources.add(payload.id);
        }
        if (message.type === "REMOVE_SOURCE" && payload?.sourceId) {
          this.sources.delete(payload.sourceId);
        }
        if (
          options.simulateWorkletSourceErrors &&
          message.type === "ADD_EFFECT" &&
          payload?.sourceId &&
          !this.sources.has(payload.sourceId)
        ) {
          queueMicrotask(() => {
            this.port.onmessage?.({
              data: {
                type: "SOURCE_ERROR",
                payload: {
                  id: "source-error-1",
                  sourceId: payload.sourceId,
                  error: `Source ${payload.sourceId} not found`,
                  code: "SOURCE_NOT_FOUND",
                  effectId: payload.effectId,
                  timestamp: 123,
                },
              },
            } as MessageEvent<WorkletPortMessage>);
          });
        }
      },
    };

    constructor(
      context: AudioContext,
      _name: string,
      _options?: AudioWorkletNodeOptions
    ) {
      super("worklet", context);
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
    readyState = HAVE_NOTHING;
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
        this.readyState = HAVE_NOTHING;
        return;
      }

      records.loadedUrls.push(this.src);
      records.events.push(`media-load:${this.src}`);
      if (
        options.failMediaUrlIncludes &&
        this.src.includes(options.failMediaUrlIncludes)
      ) {
        this.readyState = HAVE_NOTHING;
        this.error = {
          code: 2,
          message: "Simulated media network failure",
        } as MediaError;
        queueMicrotask(() => this.dispatch("error"));
        return;
      }
      this.readyState = HAVE_FUTURE_DATA;
      queueMicrotask(() => {
        this.dispatch("loadedmetadata");
        this.dispatch("canplay");
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
      // Attribute storage is irrelevant to these media lifecycle assertions.
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
  assignGlobal("HTMLMediaElement", {
    HAVE_NOTHING,
    HAVE_METADATA,
    HAVE_FUTURE_DATA,
  });
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
