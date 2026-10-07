import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { type FakeAudioElement, installBrowser } from "./fake-media-browser";
import { MediaElementPlaybackSource } from "./media-element-playback-source.js";

test("native mute works when iOS ignores media volume writes", () => {
  const browser = installBrowser();
  const source = new MediaElementPlaybackSource(null, "single");
  const audio = browser.audio();
  Object.defineProperty(audio, "volume", {
    get: () => 1,
    set: () => undefined,
  });
  try {
    source.volume = 0;
    expect(audio.muted).toBe(true);
    expect(source.volume).toBe(0);
    source.volume = 0.5;
    expect(audio.muted).toBe(false);
  } finally {
    source.cleanup();
    browser.restore();
  }
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
  test("a failed start stays stopped when late media events arrive", async () => {
    const browser = installBrowser();
    const onPlaying = mock(() => undefined);
    const onError = mock(() => undefined);
    const onBuffering = mock(() => undefined);
    const source = new MediaElementPlaybackSource(null, "youtube", {
      onBuffering,
      onError,
      onPlaying,
    });
    try {
      const audio = browser.audio();
      const loading = source.load({
        format: "progressive",
        src: "https://media.example/expired.webm",
      });
      const playing = source.play();
      const rejected = Promise.all([
        loading.catch((error: unknown) => error),
        playing.catch((error: unknown) => error),
      ]);
      await flushMicrotasks();
      audio.emit("waiting");
      expect(source.isBuffering).toBe(true);
      audio.error = { code: 2 } as MediaError;
      audio.emit("error");
      for (const error of await rejected) {
        expect(error).toHaveProperty("message", "Audio stream failed to load");
      }
      expect(onError).toHaveBeenCalledTimes(1);

      audio.emit("waiting");
      audio.emit("stalled");
      audio.emit("playing");

      expect(source.status).toBe("error");
      expect(source.isBuffering).toBe(false);
      expect(audio.autoplay).toBe(false);
      expect(audio.paused).toBe(true);
      expect(onPlaying).not.toHaveBeenCalled();
      expect(onBuffering).toHaveBeenLastCalledWith(false);
    } finally {
      source.cleanup();
      browser.restore();
    }
  });

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

  test("a refresh of a playing stream plays on its new URL", async () => {
    const browser = installBrowser();
    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      await startNativeStream(source, audio, "https://radio.example/old.mp3");

      const refresh = source.refreshUrl({
        format: "progressive",
        src: "https://radio.example/new.mp3",
      });
      await flushMicrotasks();
      audio.emit("canplay");

      expect(await refresh).toBe(true);
      expect(audio.paused).toBe(false);
      expect(audio.src).toBe("https://radio.example/new.mp3");
      source.cleanup();
    } finally {
      browser.restore();
    }
  });

  test("a pause while a refresh loads keeps the stream paused", async () => {
    const browser = installBrowser();
    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio();
      await startNativeStream(source, audio, "https://radio.example/old.mp3");

      const refresh = source.refreshUrl({
        format: "progressive",
        src: "https://radio.example/new.mp3",
      });
      await flushMicrotasks();
      source.pause();
      audio.emit("canplay");

      expect(await refresh).toBe(false);
      expect(audio.paused).toBe(true);
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

  test("sets older WebKit's prefixed key lock too", () => {
    const browser = installBrowser();
    try {
      const source = new MediaElementPlaybackSource(null, "native");
      const audio = browser.audio() as FakeAudioElement & {
        webkitPreservesPitch?: boolean;
      };
      audio.webkitPreservesPitch = true;

      source.setPreservesPitch(false);

      expect(audio.preservesPitch).toBe(false);
      expect(audio.webkitPreservesPitch).toBe(false);
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

  test("marks the finite-media terminal callback as awaiting the interrupted URL's recovery", async () => {
    const browser = installBrowser();
    const onError = mock(
      (_error: Error, _recoveryPending?: boolean) => undefined
    );
    const onStreamError = mock((_position: number, _error: Error) => undefined);
    const onPlaying = mock(() => undefined);
    const source = new MediaElementPlaybackSource(null, "native", {
      onError,
      onPlaying,
      onStreamError,
    });
    try {
      const audio = browser.audio();
      await startNativeStream(
        source,
        audio,
        "https://radio.example/expired.mp3"
      );
      audio.duration = 120;
      audio.currentTime = 42;
      audio.error = { code: 2, message: "Expired URL" } as MediaError;
      audio.emit("error");
      expect(onStreamError).toHaveBeenCalledWith(42, expect.any(Error));
      expect(onError).toHaveBeenCalledWith(expect.any(Error), true);
      expect(onStreamError.mock.calls[0]?.[1]).toBe(onError.mock.calls[0]?.[0]);

      onPlaying.mockClear();
      audio.emit("waiting");
      audio.emit("stalled");
      audio.emit("playing");
      browser.dispatchNetworkEvent("offline");
      browser.dispatchNetworkEvent("online");
      audio.emit("error");
      expect(source.status).toBe("error");
      expect(source.isBuffering).toBe(false);
      expect(onPlaying).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);

      const refreshing = source.refreshUrl({
        format: "progressive",
        src: "https://media.example/renewed.mp3",
      });
      await flushMicrotasks();
      audio.error = null;
      audio.emit("canplay");
      expect(await refreshing).toBe(true);
      audio.emit("playing");
      expect(source.status).toBe("streaming");
      expect(onPlaying).toHaveBeenCalledTimes(1);
    } finally {
      source.cleanup();
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
