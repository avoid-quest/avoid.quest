import { describe, expect, mock, test } from "bun:test";
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
    if (type === "canplay" || type === "loadedmetadata") {
      this.readyState = HTMLMediaElement.HAVE_METADATA;
    }
    this.dispatchEvent(new Event(type));
  }

  load(): void {
    // Tests drive readiness explicitly.
  }

  pause(): void {
    this.paused = true;
    this.emit("pause");
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
    value: { HAVE_METADATA: 1 },
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
    value: mock(),
  });

  return {
    getAudio: () => {
      if (!audio) {
        throw new Error("Mock audio element was not created");
      }
      return audio;
    },
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
  importStarted: () => boolean;
  importGate: Deferred<void>;
  loadedSources: string[];
} {
  const importGate = createDeferred<void>();
  let importStarted = false;
  const attachedMediaSources: Array<MediaSource | null | undefined> = [];
  const loadedSources: string[] = [];

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
          this.#media?.emit("loadedmetadata");
        });
      }

      on(): void {
        // Error handling is not exercised by these tests.
      }

      recoverMediaError(): void {
        // Error handling is not exercised by these tests.
      }
    }

    return { default: MockHls };
  });

  return {
    attachedMediaSources,
    importGate,
    importStarted: () => importStarted,
    loadedSources,
  };
}

function createPlaybackSource(): MediaElementPlaybackSource {
  return new MediaElementPlaybackSource(
    createMockAudioContext(),
    "test-source"
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

  test("keeps playback tied to the active request during a cold HLS import", async () => {
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
      activationSource.cleanup();
      pausedSource.cleanup();
    } finally {
      mediaMocks.restore();
    }
  });
});
