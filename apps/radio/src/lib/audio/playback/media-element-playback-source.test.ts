import { describe, expect, mock, test } from "bun:test";
import {
  getMediaPlaybackCandidates,
  MediaElementPlaybackSource,
} from "./media-element-playback-source";

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
  readonly loadSources: string[] = [];
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

  canPlayType(): string {
    return "";
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
  let audio: MockAudioElement | null = null;

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
    },
  };
}

function restoreDescriptor(
  name: "Audio" | "HTMLMediaElement" | "MediaError",
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
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
  importGate: Deferred<void>;
  loadedSources: string[];
} {
  const importGate = createDeferred<void>();
  const loadedSources: string[] = [];

  mock.module("hls.js", async () => {
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

      attachMedia(media: HTMLMediaElement): void {
        this.#media = media as unknown as MockAudioElement;
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

  return { importGate, loadedSources };
}

function createPlaybackSource(): MediaElementPlaybackSource {
  return new MediaElementPlaybackSource(
    createMockAudioContext(),
    "test-source"
  );
}

describe("getMediaPlaybackCandidates", () => {
  test("prefers the stream proxy for remote non-HLS URLs", () => {
    expect(
      getMediaPlaybackCandidates("https://stream-relay-geo.ntslive.net/stream2")
    ).toEqual([
      "/api/stream-proxy?url=https%3A%2F%2Fstream-relay-geo.ntslive.net%2Fstream2",
    ]);
  });

  test("keeps direct-first ordering for HLS manifests", () => {
    expect(
      getMediaPlaybackCandidates("https://radio.example/live/index.m3u8")
    ).toEqual([
      "https://radio.example/live/index.m3u8",
      "/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive%2Findex.m3u8",
    ]);
  });

  test("does not rewrite same-origin or already proxied URLs", () => {
    expect(getMediaPlaybackCandidates("/audio/local.mp3")).toEqual([
      "/audio/local.mp3",
    ]);
    expect(
      getMediaPlaybackCandidates(
        "/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Fstream"
      )
    ).toEqual(["/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Fstream"]);
  });
});

describe("MediaElementPlaybackSource HLS loading", () => {
  test("keeps playback tied to the active request during a cold HLS import", async () => {
    const mediaMocks = installMediaElementMocks();
    const hlsMock = installDelayedHlsMock();

    try {
      const activationSource = createPlaybackSource();
      const activationAudio = mediaMocks.getAudio();
      const activationLoad = activationSource.load(
        "https://radio.example/live/activation.m3u8"
      );
      const activationPlay = activationSource.play();
      const activationPlayResult = activationPlay.then(
        () => "resolved" as const,
        (error: unknown) => error
      );

      await flushMicrotasks();

      expect(activationAudio.playCalls).toBe(1);

      const pausedSource = createPlaybackSource();
      const pausedAudio = mediaMocks.getAudio();
      const pausedLoad = pausedSource.load(
        "https://radio.example/live/pause.m3u8"
      );
      const pausedPlay = pausedSource.play();
      const pausedPlayResult = pausedPlay.then(
        () => "resolved" as const,
        (error: unknown) => error
      );

      await flushMicrotasks();
      expect(pausedAudio.playCalls).toBe(1);

      pausedSource.pause();
      expect(pausedAudio.paused).toBe(true);

      const fallbackSource = createPlaybackSource();
      const fallbackAudio = mediaMocks.getAudio();
      const fallbackLoad = fallbackSource.load(
        "https://radio.example/live/fallback.m3u8"
      );
      const fallbackPlay = fallbackSource.play();
      const fallbackPlayResult = fallbackPlay.then(
        () => "resolved" as const,
        (error: unknown) => error
      );

      await flushMicrotasks();
      fallbackAudio.emit("abort");
      await flushMicrotasks();

      hlsMock.importGate.resolve();

      await expect(activationLoad).resolves.toBeUndefined();
      await expect(pausedLoad).resolves.toBeUndefined();
      await expect(fallbackLoad).resolves.toBeUndefined();
      expect(await activationPlayResult).toBe("resolved");
      expect(await pausedPlayResult).toBe("resolved");
      expect(await fallbackPlayResult).toBe("resolved");
      expect(pausedAudio.playCalls).toBe(1);
      expect(pausedAudio.paused).toBe(true);
      expect(hlsMock.loadedSources).toEqual([
        "https://radio.example/live/activation.m3u8",
        "https://radio.example/live/pause.m3u8",
        "/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive%2Ffallback.m3u8",
      ]);
      activationSource.cleanup();
      pausedSource.cleanup();
      fallbackSource.cleanup();
    } finally {
      mediaMocks.restore();
    }
  });
});
