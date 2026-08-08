import { describe, expect, jest, mock, test } from "bun:test";
import { MediaElementPlaybackSource } from "./media-element-playback-source";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => {
    throw new Error("Deferred promise resolved before initialization");
  };
  let reject: Deferred<T>["reject"] = () => {
    throw new Error("Deferred promise rejected before initialization");
  };
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class MockAudioElement {
  autoplay = false;
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = Number.POSITIVE_INFINITY;
  ended = false;
  error: MediaError | null = null;
  paused = true;
  playbackRate = 1;
  preload = "";
  readyState = 0;
  playCalls = 0;
  nativeHlsSupport = "";
  pauseEventsAreAsync = false;
  readonly loadSources: string[] = [];
  readonly playSources: string[] = [];
  #src = "";
  readonly #listeners = new Map<
    string,
    Set<{ listener: EventListener; once: boolean }>
  >();

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    this.loadSources.push(value);
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add({
      listener,
      once: typeof options === "object" && options.once === true,
    });
    this.#listeners.set(type, listeners);
  }

  canPlayType(type: string): string {
    return type === "application/vnd.apple.mpegurl"
      ? this.nativeHlsSupport
      : "";
  }

  dispatchEvent(event: Event): boolean {
    const listeners = [...(this.#listeners.get(event.type) ?? [])];
    for (const entry of listeners) {
      entry.listener.call(this, event);
      if (entry.once) {
        this.#listeners.get(event.type)?.delete(entry);
      }
    }
    return true;
  }

  emit(type: string): void {
    if (type === "loadedmetadata") {
      this.readyState = HTMLMediaElement.HAVE_METADATA;
    } else if (type === "canplay" || type === "playing") {
      this.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
      this.ended = false;
    } else if (type === "waiting") {
      this.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
    } else if (type === "ended") {
      this.ended = true;
    }
    this.dispatchEvent(new Event(type));
  }

  load(): void {
    // Tests drive readiness explicitly.
  }

  pause(): void {
    this.paused = true;
    if (this.pauseEventsAreAsync) {
      setTimeout(() => this.emit("pause"), 0);
    } else {
      this.emit("pause");
    }
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.playSources.push(this.src);
    if (!this.src) {
      return Promise.reject(
        new DOMException("No supported source is attached", "NotSupportedError")
      );
    }
    this.paused = false;
    return Promise.resolve();
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.#src = "";
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) {
      return;
    }
    for (const entry of listeners) {
      if (entry.listener === listener) {
        listeners.delete(entry);
      }
    }
  }

  setAttribute(): void {
    // Attribute values are not relevant to these tests.
  }
}

function installMediaElementMocks(): {
  getAudio: () => MockAudioElement;
  revokedObjectUrls: () => string[];
  restore: () => void;
} {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const originalHtmlMediaElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLMediaElement"
  );
  const originalMediaError = Object.getOwnPropertyDescriptor(
    globalThis,
    "MediaError"
  );
  const originalMediaSource = Object.getOwnPropertyDescriptor(
    globalThis,
    "MediaSource"
  );
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL"
  );
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL"
  );
  let audio: MockAudioElement | null = null;
  let mediaSourceId = 0;
  const revokeObjectUrl = mock((_url: string) => undefined);

  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: class AudioMock extends MockAudioElement {
      constructor() {
        super();
        audio = this;
      }
    },
  });
  Object.defineProperty(globalThis, "HTMLMediaElement", {
    configurable: true,
    value: {
      HAVE_NOTHING: 0,
      HAVE_METADATA: 1,
      HAVE_CURRENT_DATA: 2,
      HAVE_FUTURE_DATA: 3,
      HAVE_ENOUGH_DATA: 4,
    },
  });
  Object.defineProperty(globalThis, "MediaError", {
    configurable: true,
    value: {
      MEDIA_ERR_ABORTED: 1,
      MEDIA_ERR_NETWORK: 2,
      MEDIA_ERR_DECODE: 3,
      MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
    },
  });
  Object.defineProperty(globalThis, "MediaSource", {
    configurable: true,
    value: class MediaSourceMock {
      addEventListener(): void {
        // HLS mock does not exercise MediaSource events.
      }

      removeEventListener(): void {
        // HLS mock does not exercise MediaSource events.
      }
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mock(() => {
      mediaSourceId += 1;
      return `blob:mock-media-source-${mediaSourceId}`;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });

  return {
    getAudio: () => {
      if (!audio) {
        throw new Error("Mock audio element was not created");
      }
      return audio;
    },
    revokedObjectUrls: () =>
      revokeObjectUrl.mock.calls.map(([objectUrl]) => objectUrl),
    restore: () => {
      restoreDescriptor("Audio", originalAudio);
      restoreDescriptor("HTMLMediaElement", originalHtmlMediaElement);
      restoreDescriptor("MediaError", originalMediaError);
      restoreDescriptor("MediaSource", originalMediaSource);
      restoreUrlDescriptor("createObjectURL", originalCreateObjectUrl);
      restoreUrlDescriptor("revokeObjectURL", originalRevokeObjectUrl);
    },
  };
}

function restoreDescriptor(
  name: "Audio" | "HTMLMediaElement" | "MediaError" | "MediaSource",
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
}

function restoreUrlDescriptor(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
    return;
  }
  Reflect.deleteProperty(URL, name);
}

function createMockAudioContext(): AudioContext {
  return {
    createGain: () =>
      ({
        connect: mock(),
        disconnect: mock(),
        gain: { value: 1 },
      }) as unknown as GainNode,
    createMediaElementSource: () =>
      ({
        connect: mock(),
        disconnect: mock(),
      }) as unknown as MediaElementAudioSourceNode,
  } as unknown as AudioContext;
}

function installDelayedHlsMock(): {
  attachedMediaSources: Array<MediaSource | null | undefined>;
  emitFatalError: (
    type: "mediaError" | "networkError",
    handlerIndex?: number
  ) => void;
  importStarted: () => boolean;
  importGate: Deferred<void>;
  loadedSources: string[];
  recoverMediaErrorCalls: () => number;
  startLoadCalls: () => number;
} {
  const importGate = createDeferred<void>();
  let importStarted = false;
  const attachedMediaSources: Array<MediaSource | null | undefined> = [];
  const loadedSources: string[] = [];
  const errorHandlers: Array<
    (
      event: string,
      data: { details: string; fatal: boolean; type: string }
    ) => void
  > = [];
  let recoverMediaErrorCalls = 0;
  let startLoadCalls = 0;

  mock.module("hls.js", async () => {
    importStarted = true;
    await importGate.promise;

    class MockHls {
      static readonly Events = { ERROR: "ERROR" };
      static readonly ErrorTypes = {
        MEDIA_ERROR: "mediaError",
        NETWORK_ERROR: "networkError",
      };

      static isSupported(): boolean {
        return true;
      }

      #media: MockAudioElement | null = null;

      attachMedia(
        target:
          | HTMLMediaElement
          | { media: HTMLMediaElement; mediaSource?: MediaSource | null }
      ): void {
        if ("media" in target) {
          attachedMediaSources.push(target.mediaSource);
          this.#media = target.media as unknown as MockAudioElement;
          return;
        }

        attachedMediaSources.push(undefined);
        this.#media = target as unknown as MockAudioElement;
      }

      destroy(): void {
        this.#media = null;
      }

      loadSource(url: string): void {
        loadedSources.push(url);
        queueMicrotask(() => {
          this.#media?.emit("canplay");
        });
      }

      on(
        _event: string,
        handler: (
          event: string,
          data: { details: string; fatal: boolean; type: string }
        ) => void
      ): void {
        errorHandlers.push(handler);
      }

      recoverMediaError(): void {
        recoverMediaErrorCalls += 1;
      }

      startLoad(): void {
        startLoadCalls += 1;
      }
    }

    return { default: MockHls };
  });

  return {
    attachedMediaSources,
    emitFatalError: (type, handlerIndex = errorHandlers.length - 1) => {
      errorHandlers[handlerIndex]?.("ERROR", {
        details: "test-failure",
        fatal: true,
        type,
      });
    },
    importGate,
    importStarted: () => importStarted,
    loadedSources,
    recoverMediaErrorCalls: () => recoverMediaErrorCalls,
    startLoadCalls: () => startLoadCalls,
  };
}

function createPlaybackSource(
  callbacks: ConstructorParameters<typeof MediaElementPlaybackSource>[2] = {}
): MediaElementPlaybackSource {
  return new MediaElementPlaybackSource(
    createMockAudioContext(),
    "test-source",
    callbacks
  );
}

describe("MediaElementPlaybackSource HLS loading", () => {
  test("reports a direct media failure", async () => {
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      const load = source.load({
        format: "progressive",
        src: "https://one.example/audio.mp3",
      });

      await flushMicrotasks();
      expect(audio.loadSources).toEqual(["https://one.example/audio.mp3"]);
      audio.emit("error");

      const error = await load.catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      source.cleanup();
    } finally {
      mediaMocks.restore();
    }
  });

  test("does not report metadata-only media as ready", async () => {
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      let resolved = false;
      const load = source
        .load({
          format: "progressive",
          src: "https://streams.radiomast.io/nts1",
        })
        .then(() => {
          resolved = true;
        });

      await flushMicrotasks();
      audio.emit("loadedmetadata");
      await flushMicrotasks();
      expect(resolved).toBe(false);

      audio.emit("canplay");
      await expect(load).resolves.toBeUndefined();
      expect(resolved).toBe(true);
      source.cleanup();
    } finally {
      mediaMocks.restore();
    }
  });

  test("aborts readiness immediately when the source is stopped", async () => {
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const load = source.load({
        format: "progressive",
        src: "https://streams.radiomast.io/pending",
      });
      await flushMicrotasks();

      source.stop();

      await expect(load).rejects.toHaveProperty("name", "AbortError");
      source.cleanup();
    } finally {
      mediaMocks.restore();
    }
  });

  test("prefers explicitly allowed native HLS", async () => {
    const mediaMocks = installMediaElementMocks();
    const hlsMock = installDelayedHlsMock();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      audio.nativeHlsSupport = "maybe";
      const load = source.load({
        allowNativeHls: true,
        format: "hls",
        src: "https://trusted.example/live/native.m3u8",
      });

      await flushMicrotasks();
      expect(audio.loadSources).toEqual([
        "https://trusted.example/live/native.m3u8",
      ]);
      expect(hlsMock.importStarted()).toBe(false);
      audio.emit("canplay");
      await expect(load).resolves.toBeUndefined();
      source.cleanup();
    } finally {
      hlsMock.importGate.resolve();
      mediaMocks.restore();
    }
  });

  test("waits for no progress before reloading a live progressive stream", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      const url = "https://streams.radiomast.io/nts1";
      const load = source.load({ format: "progressive", src: url });
      await flushMicrotasks();
      audio.emit("canplay");
      await load;
      await source.play();
      audio.emit("playing");

      audio.emit("waiting");
      jest.advanceTimersByTime(5999);
      await flushMicrotasks();
      expect(audio.loadSources).toEqual([url]);

      jest.advanceTimersByTime(1);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();
      expect(audio.loadSources).toEqual([url, url]);

      audio.emit("canplay");
      await flushMicrotasks();
      audio.emit("playing");
      expect(source.status).toBe("streaming");
      expect(source.isBuffering).toBe(false);
      source.cleanup();
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });

  test("does not reload for a stalled event while playable data remains", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      const url = "https://streams.radiomast.io/nts2";
      const load = source.load({ format: "progressive", src: url });
      await flushMicrotasks();
      audio.emit("canplay");
      await load;
      await source.play();
      audio.emit("playing");

      audio.emit("stalled");
      expect(source.isBuffering).toBe(false);
      audio.currentTime = 1;
      jest.advanceTimersByTime(6000);
      await flushMicrotasks();
      expect(audio.loadSources).toEqual([url]);
      source.cleanup();
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });

  test("caps fetch-only grace when the media clock remains frozen", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      const url = "https://streams.radiomast.io/nts1";
      const load = source.load({ format: "progressive", src: url });
      await flushMicrotasks();
      audio.emit("canplay");
      await load;
      await source.play();
      audio.emit("playing");

      audio.emit("waiting");
      audio.emit("progress");
      jest.advanceTimersByTime(6000);
      audio.emit("progress");
      jest.advanceTimersByTime(6000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();
      expect(audio.loadSources).toEqual([url, url]);
      source.cleanup();
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });

  test("keeps the no-progress deadline across repeated playing events", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      const url = "https://streams.radiomast.io/nts1";
      const load = source.load({ format: "progressive", src: url });
      await flushMicrotasks();
      audio.emit("canplay");
      await load;
      await source.play();
      audio.emit("playing");

      audio.emit("waiting");
      audio.emit("progress");
      jest.advanceTimersByTime(3000);
      audio.emit("playing");
      audio.emit("progress");
      jest.advanceTimersByTime(3000);
      audio.emit("progress");
      jest.advanceTimersByTime(3000);
      audio.emit("playing");
      audio.emit("progress");
      jest.advanceTimersByTime(3000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();

      expect(audio.loadSources).toEqual([url, url]);
      source.cleanup();
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });

  test("preserves advancing buffered playback across a network handoff", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();

    try {
      const source = createPlaybackSource();
      const audio = mediaMocks.getAudio();
      const url = "https://streams.radiomast.io/nts2";
      const load = source.load({ format: "progressive", src: url });
      await flushMicrotasks();
      audio.emit("canplay");
      await load;
      await source.play();
      audio.emit("playing");

      const networkHandlers = source as unknown as {
        handleOffline: () => void;
        handleOnline: () => void;
      };
      networkHandlers.handleOffline();
      expect(source.isBuffering).toBe(false);
      networkHandlers.handleOnline();
      audio.currentTime = 1;
      jest.advanceTimersByTime(6000);
      await flushMicrotasks();

      expect(audio.loadSources).toEqual([url]);
      expect(source.status).toBe("streaming");
      source.cleanup();
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });

  test("publishes one pause when the media event is task-queued", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();
    const onPaused = mock(() => undefined);

    try {
      const source = createPlaybackSource({ onPaused });
      const audio = mediaMocks.getAudio();
      const load = source.load({
        format: "progressive",
        src: "https://streams.radiomast.io/nts2",
      });
      await flushMicrotasks();
      audio.emit("canplay");
      await load;
      await source.play();
      audio.emit("playing");
      audio.pauseEventsAreAsync = true;

      source.pause();
      expect(onPaused).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();
      expect(onPaused).toHaveBeenCalledTimes(1);
      source.cleanup();
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });

  test("keeps cold HLS playback tied to active requests and recovers fatal errors in place", async () => {
    jest.useFakeTimers();
    const mediaMocks = installMediaElementMocks();
    const hlsMock = installDelayedHlsMock();

    try {
      const activationSource = createPlaybackSource();
      const activationAudio = mediaMocks.getAudio();
      activationAudio.nativeHlsSupport = "maybe";
      const activationLoad = activationSource.load({
        format: "hls",
        src: "https://radio.example/live/activation.m3u8",
      });
      const activationPlay = activationSource.play();
      const activationPlayResult = activationPlay.then(
        () => "resolved" as const,
        (error: unknown) => error
      );

      await flushMicrotasks();

      expect(hlsMock.importStarted()).toBe(true);
      expect(activationAudio.playCalls).toBe(1);
      expect(activationAudio.playSources).toEqual(["blob:mock-media-source-1"]);

      const pausedSource = createPlaybackSource();
      const pausedAudio = mediaMocks.getAudio();
      const pausedLoad = pausedSource.load({
        format: "hls",
        src: "https://radio.example/live/pause.m3u8",
      });
      const pausedPlay = pausedSource.play();
      const pausedPlayResult = pausedPlay.then(
        () => "resolved" as const,
        (error: unknown) => error
      );

      await flushMicrotasks();
      expect(pausedAudio.playCalls).toBe(1);
      expect(pausedAudio.playSources).toEqual(["blob:mock-media-source-2"]);

      pausedSource.pause();
      expect(pausedAudio.paused).toBe(true);

      hlsMock.importGate.resolve();

      await expect(activationLoad).resolves.toBeUndefined();
      await expect(pausedLoad).resolves.toBeUndefined();
      expect(await activationPlayResult).toBe("resolved");
      expect(await pausedPlayResult).toBe("resolved");
      expect(pausedAudio.playCalls).toBe(1);
      expect(pausedAudio.paused).toBe(true);
      expect(hlsMock.attachedMediaSources).toHaveLength(2);
      expect(hlsMock.attachedMediaSources.every(Boolean)).toBe(true);
      expect(hlsMock.loadedSources).toEqual([
        "https://radio.example/live/activation.m3u8",
        "https://radio.example/live/pause.m3u8",
      ]);
      hlsMock.emitFatalError("networkError", 0);
      expect(hlsMock.startLoadCalls()).toBe(1);

      jest.advanceTimersByTime(6000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();
      expect(hlsMock.loadedSources).toEqual([
        "https://radio.example/live/activation.m3u8",
        "https://radio.example/live/pause.m3u8",
        "https://radio.example/live/activation.m3u8",
      ]);

      // A destroyed same-generation HLS instance must not recover or re-arm
      // the replacement attachment when it emits a queued fatal event.
      hlsMock.emitFatalError("networkError", 0);
      expect(hlsMock.startLoadCalls()).toBe(1);

      hlsMock.emitFatalError("mediaError", 2);
      expect(hlsMock.recoverMediaErrorCalls()).toBe(1);
      activationSource.cleanup();
      pausedSource.cleanup();
      expect(mediaMocks.revokedObjectUrls()).toEqual([
        "blob:mock-media-source-1",
        "blob:mock-media-source-3",
        "blob:mock-media-source-2",
      ]);
    } finally {
      jest.useRealTimers();
      mediaMocks.restore();
    }
  });
});
