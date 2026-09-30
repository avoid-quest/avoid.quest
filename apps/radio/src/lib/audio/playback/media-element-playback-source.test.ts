import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { MediaElementPlaybackSource } from "./media-element-playback-source.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeAudioElement {
  autoplay = false;
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = Number.POSITIVE_INFINITY;
  ended = false;
  error: MediaError | null = null;
  muted = false;
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  preload = "";
  readyState = 0;
  volume = 1;
  nativeHlsSupport = "";
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

  canPlayType(type: string): string {
    return type === "application/vnd.apple.mpegurl"
      ? this.nativeHlsSupport
      : "";
  }

  emit(type: string): void {
    if (type === "canplay" || type === "playing") {
      this.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
      this.ended = false;
    } else if (type === "waiting" || type === "stalled") {
      this.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
    }
    const event = new Event(type);
    for (const entry of [...(this.#listeners.get(type) ?? [])]) {
      entry.listener.call(this, event);
      if (entry.once) {
        this.#listeners.get(type)?.delete(entry);
      }
    }
  }

  load(): void {
    // Tests drive readiness explicitly.
  }

  pause(): void {
    this.paused = true;
    this.emit("pause");
  }

  play(): Promise<void> {
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

type InstalledBrowser = {
  audio: () => FakeAudioElement;
  dispatchNetworkEvent: (type: "offline" | "online") => void;
  restore: () => void;
};

function installBrowser(): InstalledBrowser {
  const descriptors = new Map(
    ["Audio", "HTMLMediaElement", "MediaError", "navigator"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ])
  );
  const originalAddEventListener = globalThis.addEventListener;
  const originalRemoveEventListener = globalThis.removeEventListener;
  const networkListeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();
  let audio: FakeAudioElement | null = null;

  Object.defineProperties(globalThis, {
    Audio: {
      configurable: true,
      value: class extends FakeAudioElement {
        constructor() {
          super();
          audio = this;
        }
      },
    },
    HTMLMediaElement: {
      configurable: true,
      value: {
        HAVE_CURRENT_DATA: 2,
        HAVE_ENOUGH_DATA: 4,
        HAVE_FUTURE_DATA: 3,
        HAVE_METADATA: 1,
        HAVE_NOTHING: 0,
      },
    },
    MediaError: {
      configurable: true,
      value: {
        MEDIA_ERR_ABORTED: 1,
        MEDIA_ERR_DECODE: 3,
        MEDIA_ERR_NETWORK: 2,
        MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
      },
    },
    navigator: { configurable: true, value: { onLine: true } },
  });
  globalThis.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => {
    const listeners = networkListeners.get(type) ?? new Set();
    listeners.add(listener);
    networkListeners.set(type, listeners);
  };
  globalThis.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => {
    networkListeners.get(type)?.delete(listener);
  };

  return {
    audio: () => {
      if (!audio) {
        throw new Error("Audio element was not created");
      }
      return audio;
    },
    dispatchNetworkEvent: (type) => {
      Object.defineProperty(globalThis.navigator, "onLine", {
        configurable: true,
        value: type === "online",
      });
      const event = new Event(type);
      for (const listener of networkListeners.get(type) ?? []) {
        if (typeof listener === "function") {
          listener.call(globalThis, event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
    restore: () => {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      for (const [name, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}

async function startNativeStream(
  source: MediaElementPlaybackSource,
  audio: FakeAudioElement,
  url: string
): Promise<void> {
  const load = source.load({ format: "progressive", src: url });
  await flushMicrotasks();
  audio.emit("canplay");
  await load;
  await source.play();
  audio.emit("playing");
}

function installHlsMock(): {
  emitFatalNetworkError: () => void;
  loadedSources: string[];
  restartedLoads: true[];
} {
  const loadedSources: string[] = [];
  const restartedLoads: true[] = [];
  const errorHandlers: Array<
    (
      event: string,
      data: { details: string; fatal: boolean; type: string }
    ) => void
  > = [];

  mock.module("hls.js", () => ({
    default: class MockHls {
      static readonly Events = { ERROR: "ERROR" };
      static readonly ErrorTypes = {
        MEDIA_ERROR: "mediaError",
        NETWORK_ERROR: "networkError",
      };

      static isSupported(): boolean {
        return true;
      }

      #media: FakeAudioElement | null = null;

      attachMedia(
        target:
          | HTMLMediaElement
          | { media: HTMLMediaElement; mediaSource?: MediaSource | null }
      ): void {
        this.#media = ("media" in target
          ? target.media
          : target) as unknown as FakeAudioElement;
      }

      destroy(): void {
        this.#media = null;
      }

      loadSource(url: string): void {
        loadedSources.push(url);
        queueMicrotask(() => this.#media?.emit("canplay"));
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
        // This test covers fatal network recovery.
      }

      startLoad(): void {
        restartedLoads.push(true);
      }
    },
  }));

  return {
    emitFatalNetworkError: () => {
      errorHandlers[0]?.("ERROR", {
        details: "test failure",
        fatal: true,
        type: "networkError",
      });
    },
    loadedSources,
    restartedLoads,
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe("MediaElementPlaybackSource native playback", () => {
  test("supersedes a pending attachment and ignores its readiness", async () => {
    const browser = installBrowser();
    const onReady = mock(() => undefined);

    try {
      const source = new MediaElementPlaybackSource(null, "native", {
        onReady,
      });
      const audio = browser.audio();
      const firstLoad = source.load({
        format: "progressive",
        src: "https://radio.example/first.mp3",
      });
      await flushMicrotasks();
      const secondLoad = source.load({
        format: "progressive",
        src: "https://radio.example/second.mp3",
      });

      await expect(firstLoad).rejects.toHaveProperty("name", "AbortError");
      audio.emit("canplay");
      await expect(secondLoad).resolves.toBeUndefined();
      expect(audio.loadSources).toEqual([
        "https://radio.example/first.mp3",
        "https://radio.example/second.mp3",
      ]);
      expect(onReady).toHaveBeenCalledTimes(1);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("keeps its speed through a load and sets key lock on the element", () => {
    const browser = installBrowser();
    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();

      source.setPlaybackRate(4);
      source.setPreservesPitch(false);

      // A load resets the rate to the default one, so both move together.
      expect(audio.playbackRate).toBe(2);
      expect(audio.defaultPlaybackRate).toBe(2);
      expect(audio.preservesPitch).toBe(false);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("aborts a pending attachment when stopped", async () => {
    const browser = installBrowser();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const load = source.load({
        format: "progressive",
        src: "https://radio.example/pending.mp3",
      });
      await flushMicrotasks();

      source.stop();

      await expect(load).rejects.toHaveProperty("name", "AbortError");
      expect(source.status).toBe("ended");
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("uses explicitly allowed native HLS without changing its lifecycle", async () => {
    const browser = installBrowser();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      audio.nativeHlsSupport = "maybe";
      const url = "https://radio.example/live.m3u8";
      const load = source.load({
        allowNativeHls: true,
        format: "hls",
        src: url,
      });
      await flushMicrotasks();
      audio.emit("canplay");

      await expect(load).resolves.toBeUndefined();
      expect(audio.loadSources).toEqual([url]);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("keeps active HLS attachment ownership through recovery", async () => {
    jest.useFakeTimers();
    const browser = installBrowser();
    const hls = installHlsMock();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      const url = "https://radio.example/live.m3u8";
      await source.load({ format: "hls", src: url });
      await source.play();
      audio.emit("playing");

      hls.emitFatalNetworkError();
      jest.advanceTimersByTime(6000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();

      expect(hls.loadedSources).toEqual([url, url]);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("restarts HLS loading immediately after a fatal network error", async () => {
    const browser = installBrowser();
    const hls = installHlsMock();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      await source.load({
        format: "hls",
        src: "https://radio.example/live.m3u8",
      });
      await source.play();
      audio.emit("playing");

      hls.emitFatalNetworkError();

      expect(hls.restartedLoads).toHaveLength(1);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test.each(["waiting", "stalled"] as const)(
    "reloads after six seconds without progress after %s",
    async (eventType) => {
      jest.useFakeTimers();
      const browser = installBrowser();

      try {
        const source = new MediaElementPlaybackSource(null, "native");
        const audio = browser.audio();
        const url = "https://radio.example/live.mp3";
        await startNativeStream(source, audio, url);

        audio.emit(eventType);
        jest.advanceTimersByTime(6000);
        jest.advanceTimersByTime(0);
        await flushMicrotasks();

        expect(audio.loadSources).toEqual([url, url]);
        source.cleanup();
      } finally {
        browser.restore();
      }
    }
  );

  test("reloads after connectivity returns without media progress", async () => {
    jest.useFakeTimers();
    const browser = installBrowser();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      const url = "https://radio.example/live.mp3";
      await startNativeStream(source, audio, url);

      browser.dispatchNetworkEvent("offline");
      browser.dispatchNetworkEvent("online");
      jest.advanceTimersByTime(6000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();

      expect(audio.loadSources).toEqual([url, url]);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("gives fetch progress one extra watchdog window", async () => {
    jest.useFakeTimers();
    const browser = installBrowser();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      const url = "https://radio.example/live.mp3";
      await startNativeStream(source, audio, url);

      audio.emit("waiting");
      audio.emit("progress");
      jest.advanceTimersByTime(6000);
      await flushMicrotasks();
      expect(audio.loadSources).toEqual([url]);

      jest.advanceTimersByTime(6000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();
      expect(audio.loadSources).toEqual([url, url]);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("cancels a pending recovery when playback is paused", async () => {
    jest.useFakeTimers();
    const browser = installBrowser();

    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      const url = "https://radio.example/live.mp3";
      await startNativeStream(source, audio, url);

      audio.emit("waiting");
      source.pause();
      jest.advanceTimersByTime(6000);
      jest.advanceTimersByTime(0);
      await flushMicrotasks();

      expect(audio.loadSources).toEqual([url]);
      source.cleanup();
    } finally {
      browser.restore();
    }
  });
});
