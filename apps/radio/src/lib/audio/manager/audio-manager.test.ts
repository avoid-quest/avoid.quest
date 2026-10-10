import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { installBrowser } from "../playback/fake-media-browser";
import type { AudioState, PlaybackSource } from "../playback/index.js";
import {
  FakeAudioContext,
  type FakeAudioParam,
} from "../routing/fake-audio-nodes";
import type {
  AudioNodes,
  MainOutputConnect,
  SoundInstance,
  SoundOutputConnector,
} from "./audio-manager-types";
import {
  capturedStream,
  createDeviceCaptureHarness,
} from "./device-capture-test-harness";
import type { SoundRegistry } from "./sound-registry";

// Other test files replace this module with mock.module, which leaks across
// files in one `bun test` process. The query suffix loads a real instance.
const { AudioManager } = (await import(
  `./audio-manager.ts?${"unmocked"}`
)) as typeof import("./audio-manager");

type AudioManagerInstance = ReturnType<typeof AudioManager.getInstance>;

function getRegistry(manager: AudioManagerInstance): SoundRegistry {
  return (manager as unknown as { soundRegistry: SoundRegistry }).soundRegistry;
}

function createPendingSource(): PlaybackSource {
  return {
    cleanup: () => undefined,
    isActive: true,
    pause: () => undefined,
    play: () => new Promise<void>(() => undefined),
    stop: () => undefined,
  } as unknown as PlaybackSource;
}

function createMediaPlaybackHarness() {
  const capture = createDeviceCaptureHarness();
  const browser = installBrowser();
  const { manager, context } = capture;
  Object.assign(context, {
    createMediaElementSource: () => context.createGain(),
  });
  const internals = manager as unknown as {
    effects: { connectGraph: () => Promise<boolean> };
    output: {
      getMainMeterSource: () => unknown;
      replaceContext: () => Promise<void>;
    };
  };
  internals.output.getMainMeterSource = () => context.createGain();
  internals.output.replaceContext = async () => undefined;
  return {
    ...capture,
    browser,
    effects: internals.effects,
    restore() {
      browser.restore();
      capture.restore();
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: advance each deferred media lifecycle step in order
    await Promise.resolve();
  }
}

type GraphHarness = {
  connectMain: ReturnType<typeof mock<MainOutputConnect>>;
  connect: (soundId: string) => Promise<AudioNodes>;
};

/**
 * Swaps the manager's output routing, effects and meters for fakes, then
 * connects sounds through the real connectAudioGraph path.
 */
function createGraphHarness(manager: AudioManagerInstance): GraphHarness {
  const context = new FakeAudioContext();
  const connectMain = mock<MainOutputConnect>(() => () => undefined);
  const internals = manager as unknown as {
    connectAudioGraph: (instance: SoundInstance) => Promise<boolean>;
    effects: { connectGraph: () => Promise<boolean> };
    meters: { setSoundSource: () => Promise<void> };
    output: { cleanup: () => void; connectMain: MainOutputConnect };
  };
  internals.output = { cleanup: () => undefined, connectMain };
  internals.effects.connectGraph = async () => true;
  internals.meters.setSoundSource = async () => undefined;

  return {
    async connect(soundId) {
      const instance = getRegistry(manager).get(soundId);
      if (!instance) {
        throw new Error(`sound ${soundId} was not created`);
      }
      const nodes = {
        filter: context.createGain(),
        gain: context.createGain(),
        pan: context.createGain(),
        preFaderSend: context.createGain(),
      } as unknown as AudioNodes;
      instance.nodes = nodes;
      instance.playbackSource = {
        ...createPendingSource(),
        output: context.createGain(),
      } as unknown as PlaybackSource;
      expect(await internals.connectAudioGraph(instance)).toBe(true);
      return nodes;
    },
    connectMain,
  };
}

const station = {
  id: "station",
  name: "Station",
  streamUrl: "https://radio.example/station.mp3",
};
const providerTrack = {
  ...station,
  platformMetadata: {
    itemType: "track" as const,
    platform: "soundcloud" as const,
    url: "https://soundcloud.com/artist/track",
  },
};

afterEach(() => {
  AudioManager.resetInstance();
  jest.useRealTimers();
});

describe("AudioManager", () => {
  test.each([
    [Number.POSITIVE_INFINITY, 1],
    [120, 1],
    [120, 2],
  ])(
    "a live stream reloads after duration %s and transient media error %s",
    async (duration, code) => {
      jest.useFakeTimers();
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser } = harness;
        const soundId = manager.createSound(
          station,
          "single:station",
          "native"
        );
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const starting = manager.playSound(soundId);
        await flushMicrotasks();
        const audio = browser.audio();
        audio.emit("canplay");
        await starting;
        audio.emit("playing");
        audio.duration = duration;
        audio.error = { code } as MediaError;
        audio.emit("error");
        audio.pause();
        const playCount = audio.playPositions.length;

        expect(states.at(-1)?.error).toBeNull();
        expect(getRegistry(manager).get(soundId)?.playbackSource?.status).toBe(
          "buffering"
        );
        jest.advanceTimersByTime(6000);
        jest.advanceTimersByTime(0);
        await flushMicrotasks();
        expect(audio.loadSources).toEqual([
          station.streamUrl,
          station.streamUrl,
        ]);
        audio.error = null;
        audio.emit("canplay");
        await flushMicrotasks();
        expect(audio.playPositions).toHaveLength(playCount + 1);
        expect(audio.paused).toBe(false);
        audio.emit("playing");
        expect(states.at(-1)).toMatchObject({
          error: null,
          isBuffering: false,
          isPlaying: true,
        });
      } finally {
        harness.restore();
      }
    }
  );

  test.each([
    ["provider track", providerTrack, undefined],
    ["provider in a Station", providerTrack, "station"],
    ["imported file without metadata", station, "media"],
  ] as const)(
    "%s still requests URL renewal at the interrupted position",
    async (_name, radio, sourceKind) => {
      jest.useFakeTimers();
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser } = harness;
        const soundId = manager.createSound(
          radio,
          "track",
          "native",
          sourceKind
        );
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const starting = manager.playSound(soundId);
        await flushMicrotasks();
        const audio = browser.audio();
        audio.emit("canplay");
        await starting;
        audio.emit("playing");
        audio.duration = 120;
        audio.currentTime = 42;
        audio.error = { code: MediaError.MEDIA_ERR_NETWORK } as MediaError;
        audio.emit("error");

        expect(
          states.some(
            (state) =>
              state.error?.code === "STREAM_INTERRUPTED" &&
              state.error.position === 42
          )
        ).toBe(true);
        expect(states.at(-1)?.error).toMatchObject({ recoveryPending: true });
        jest.advanceTimersByTime(6000);
        jest.advanceTimersByTime(0);
        await flushMicrotasks();
        expect(audio.loadSources).toEqual([radio.streamUrl]);

        const renewedUrl = "https://media.example/renewed.mp3";
        const refreshing = manager.refreshStreamUrl(soundId, renewedUrl, 42);
        await flushMicrotasks();
        audio.error = null;
        audio.emit("canplay");
        await refreshing;
        audio.emit("playing");
        expect(audio.playPositions.at(-1)).toBe(42);
        expect(states.at(-1)).toMatchObject({ error: null, isPlaying: true });

        // Renewal must preserve the source's finite-media classification.
        audio.error = { code: MediaError.MEDIA_ERR_NETWORK } as MediaError;
        audio.emit("error");
        expect(states.at(-1)?.error).toMatchObject({ recoveryPending: true });
        jest.advanceTimersByTime(6000);
        jest.advanceTimersByTime(0);
        await flushMicrotasks();
        expect(audio.loadSources).toEqual([radio.streamUrl, renewedUrl]);
      } finally {
        harness.restore();
      }
    }
  );

  test.each(["before reconnect", "while reconnecting"])(
    "pausing %s cancels live recovery and ignores late playback events",
    async (phase) => {
      jest.useFakeTimers();
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser } = harness;
        const soundId = manager.createSound(
          station,
          "single:station",
          "native"
        );
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const starting = manager.playSound(soundId);
        await flushMicrotasks();
        const audio = browser.audio();
        audio.emit("canplay");
        await starting;
        audio.emit("playing");
        audio.duration = 120;
        audio.error = { code: MediaError.MEDIA_ERR_ABORTED } as MediaError;
        audio.emit("error");
        if (phase === "while reconnecting") {
          jest.advanceTimersByTime(6000);
          jest.advanceTimersByTime(0);
          await flushMicrotasks();
          expect(audio.loadSources).toEqual([
            station.streamUrl,
            station.streamUrl,
          ]);
        }

        manager.pauseSound(soundId);
        const playCount = audio.playPositions.length;
        audio.emit("abort");
        audio.error = null;
        audio.emit("canplay");
        audio.emit("playing");
        jest.advanceTimersByTime(60_000);
        await flushMicrotasks();

        expect(audio.loadSources).toHaveLength(
          phase === "while reconnecting" ? 2 : 1
        );
        expect(audio.playPositions).toHaveLength(playCount);
        expect(audio.paused).toBe(true);
        expect(states.some((state) => state.error)).toBe(false);
        expect(states.at(-1)).toMatchObject({
          isBuffering: false,
          isLoading: false,
          isPlaying: false,
        });
      } finally {
        harness.restore();
      }
    }
  );

  test.each([2, 3])(
    "a live station's initial media error %s remains a reported start failure",
    async (code) => {
      jest.useFakeTimers();
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser } = harness;
        const soundId = manager.createSound(
          station,
          "single:station",
          "native"
        );
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const starting = manager
          .playSound(soundId)
          .catch((error: unknown) => error);
        await flushMicrotasks();
        const audio = browser.audio();
        audio.duration = 120;
        audio.error = { code } as MediaError;
        audio.emit("error");

        expect(await starting).toBeInstanceOf(Error);
        expect(
          states.some(
            (state) =>
              state.error?.duringStart &&
              state.error.code === "STREAM_FETCH_FAILED"
          )
        ).toBe(true);
        jest.advanceTimersByTime(60_000);
        await flushMicrotasks();
        expect(audio.loadSources).toEqual([station.streamUrl]);
        expect(audio.paused).toBe(true);
        expect(states.at(-1)).toMatchObject({
          isBuffering: false,
          isLoading: false,
          isPlaying: false,
        });
      } finally {
        harness.restore();
      }
    }
  );

  test("fresh playback awaits the effects graph even when media playback is ready", async () => {
    const harness = createMediaPlaybackHarness();
    const graph = Promise.withResolvers<boolean>();
    try {
      const { manager, browser, effects } = harness;
      effects.connectGraph = () => graph.promise;
      const soundId = manager.createSound(station, "node:n:video");
      let settled = false;
      const playing = manager.playSound(soundId).then(() => {
        settled = true;
      });
      await flushMicrotasks();
      browser.audio().emit("canplay");
      await flushMicrotasks();
      expect(browser.audio().paused).toBe(false);
      expect(settled).toBe(false);
      graph.resolve(true);
      await playing;
      expect(settled).toBe(true);
    } finally {
      harness.restore();
    }
  });

  test("unsupported Safari live radio leaves the Node sound stopped", async () => {
    const harness = createMediaPlaybackHarness();
    try {
      Object.defineProperty(navigator, "userAgent", {
        value:
          "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15",
      });
      const { manager, effects } = harness;
      effects.connectGraph = mock(async () => true);
      const soundId = manager.createSound(station, "node:n:radio");
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => states.push(state));
      await expect(manager.playSound(soundId)).rejects.toMatchObject({
        code: "UNSUPPORTED_RADIO_GRAPH",
        expected: true,
      });
      expect(getRegistry(manager).get(soundId)?.playbackSource).toBeNull();
      expect(effects.connectGraph).not.toHaveBeenCalled();
      expect(states.at(-1)).toMatchObject({
        isBuffering: false,
        isLoading: false,
        isPlaying: false,
      });
    } finally {
      harness.restore();
    }
  });

  test("Safari plays an imported finite File without metadata and still rejects HLS refresh", async () => {
    const harness = createMediaPlaybackHarness();
    try {
      Object.defineProperty(navigator, "userAgent", {
        value: "AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15",
      });
      const { manager, browser, effects } = harness;
      effects.connectGraph = mock(async () => true);
      const soundId = manager.createSound(
        { name: "Imported MP3", streamUrl: "https://media.example/track.mp3" },
        "node:n:file",
        "audio-graph",
        "media"
      );
      const starting = manager.playSound(soundId);
      await flushMicrotasks();
      browser.audio().emit("canplay");
      await starting;
      expect(browser.audio().paused).toBe(false);
      const refreshing = manager.refreshStreamUrl(
        soundId,
        "https://media.example/track-renewed.mp3"
      );
      await flushMicrotasks();
      browser.audio().emit("canplay");
      await refreshing;
      expect(browser.audio().src).toBe(
        "https://media.example/track-renewed.mp3"
      );
      await expect(
        manager.refreshStreamUrl(
          soundId,
          "https://media.example/live",
          undefined,
          "hls"
        )
      ).rejects.toMatchObject({ code: "UNSUPPORTED_RADIO_GRAPH" });
    } finally {
      harness.restore();
    }
  });

  test.each(["audio-graph", "native"] as const)(
    "Safari HLS refresh preserves a rejected graph's playback and permits native playback (%s)",
    async (mode) => {
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser, effects } = harness;
        Object.defineProperty(navigator, "userAgent", {
          value: "AppleWebKit/605.1.15",
        });
        effects.connectGraph = mock(async () => true);
        const soundId = manager.createSound(providerTrack, "track", mode);
        const starting = manager.playSound(soundId);
        await flushMicrotasks();
        const audio = browser.audio();
        audio.nativeHlsSupport = "probably";
        audio.emit("canplay");
        await starting;
        const previousRadio = manager.getSoundRadio(soundId);
        const previousSource =
          getRegistry(manager).get(soundId)?.playbackSource;
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        audio.emit("playing");
        const refreshing = manager.refreshStreamUrl(
          soundId,
          "https://cf-hls-media.sndcdn.com/extensionless",
          undefined,
          "hls"
        );
        if (mode === "audio-graph") {
          await expect(refreshing).rejects.toMatchObject({
            code: "UNSUPPORTED_RADIO_GRAPH",
            expected: true,
          });
          expect(audio.loadSources).not.toContain(
            "https://cf-hls-media.sndcdn.com/extensionless"
          );
          expect(manager.getSoundRadio(soundId)).toBe(previousRadio);
          expect(audio.paused).toBe(false);
          expect(getRegistry(manager).get(soundId)?.playbackSource).toBe(
            previousSource
          );
          expect(states.at(-1)).toMatchObject({
            error: null,
            isBuffering: false,
            isLoading: false,
            isPlaying: true,
          });
          // The rejected stream never shows as loading.
          expect(states.map((state) => state.isLoading)).not.toContain(true);
          manager.pauseSound(soundId);
          await manager.playSound(soundId);
          expect(audio.paused).toBe(false);
          expect(audio.loadSources).toEqual([providerTrack.streamUrl]);
        } else {
          await flushMicrotasks();
          audio.emit("canplay");
          await refreshing;
          expect(audio.paused).toBe(false);
          expect(audio.src).toBe(
            "https://cf-hls-media.sndcdn.com/extensionless"
          );
        }
      } finally {
        harness.restore();
      }
    }
  );

  test("an incompatible Safari refresh preserves an unstarted sound's configuration", async () => {
    const harness = createMediaPlaybackHarness();
    try {
      const { manager, browser, effects } = harness;
      Object.defineProperty(navigator, "userAgent", {
        value: "AppleWebKit/605.1.15",
      });
      effects.connectGraph = mock(async () => true);
      const soundId = manager.createSound(providerTrack, "track");
      const previousRadio = manager.getSoundRadio(soundId);
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => states.push(state));

      await expect(
        manager.refreshStreamUrl(
          soundId,
          "https://cf-hls-media.sndcdn.com/extensionless",
          undefined,
          "hls"
        )
      ).rejects.toMatchObject({
        code: "UNSUPPORTED_RADIO_GRAPH",
        expected: true,
      });

      expect(manager.getSoundRadio(soundId)).toBe(previousRadio);
      expect(getRegistry(manager).get(soundId)?.playbackSource).toBeNull();
      expect(effects.connectGraph).not.toHaveBeenCalled();
      expect(states).toEqual([]);

      const starting = manager.playSound(soundId);
      await flushMicrotasks();
      browser.audio().emit("canplay");
      await starting;
      expect(browser.audio().loadSources).toEqual([providerTrack.streamUrl]);
      expect(browser.audio().paused).toBe(false);
    } finally {
      harness.restore();
    }
  });

  test("a fresh source's graph-start failure cleans up without advancing the playlist", async () => {
    const harness = createMediaPlaybackHarness();
    try {
      const { manager, effects, browser } = harness;
      const failure = new Error("Graph setup failed");
      effects.connectGraph = mock(() => Promise.reject(failure));
      const soundId = manager.createSound(station, "node:n:video");
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => states.push(state));

      await expect(manager.playSound(soundId)).rejects.toBe(failure);

      expect(effects.connectGraph).toHaveBeenCalledTimes(1);
      expect(harness.connectMain).toHaveBeenCalledTimes(1);
      expect(getRegistry(manager).get(soundId)?.playbackSource).toBeNull();
      expect(browser.audio().paused).toBe(true);
      expect(browser.audio().src).toBe("");
      expect(states.some((state) => state.hasEnded)).toBe(false);
      expect(states.at(-1)).toMatchObject({
        isBuffering: false,
        isLoading: false,
        isPlaying: false,
      });
    } finally {
      harness.restore();
    }
  });

  test("an older rejected start cannot clean up a replacement on the same sound", async () => {
    const harness = createMediaPlaybackHarness();
    const graph = Promise.withResolvers<boolean>();
    try {
      const { manager, browser, effects } = harness;
      effects.connectGraph = mock(() =>
        Promise.resolve(true)
      ).mockImplementationOnce(() => graph.promise);
      const soundId = manager.createSound(station, "node:n:video");
      const older = manager.playSound(soundId).catch((error: unknown) => error);
      await flushMicrotasks();
      browser.audio().emit("waiting");

      manager.stopSound(soundId);
      expect(getRegistry(manager).get(soundId)?.buffering).toBe(false);
      const newer = manager.playSound(soundId).catch((error: unknown) => error);
      const replacement = getRegistry(manager).get(soundId)?.playbackSource;
      const audio = browser.audio();
      await flushMicrotasks();
      audio.emit("canplay");
      graph.resolve(true);
      await older;

      expect(await newer).toBeUndefined();
      expect(getRegistry(manager).get(soundId)?.playbackSource).toBe(
        replacement
      );
      expect(audio.paused).toBe(false);
      expect(audio.src).toBe(station.streamUrl);
    } finally {
      graph.resolve(true);
      harness.restore();
    }
  });

  test.each(["audio-graph", "native"] as const)(
    "a paused %s start ignores a later load abort through production callbacks",
    async (mode) => {
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser } = harness;
        const soundId = manager.createSound(station, "node:n:video", mode);
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const starting = manager
          .playSound(soundId)
          .catch((error: unknown) => error);
        await flushMicrotasks();
        manager.pauseSound(soundId);
        const stateCount = states.length;
        browser.audio().emit("abort");
        await starting;

        expect(states.slice(stateCount).some((state) => state.error)).toBe(
          false
        );
        expect(states.at(-1)).toMatchObject({
          error: null,
          isLoading: false,
          isPlaying: false,
        });
      } finally {
        harness.restore();
      }
    }
  );

  test.each(["audio-graph", "native"] as const)(
    "a recreated %s source seeks before its first playback",
    async (mode) => {
      const harness = createMediaPlaybackHarness();
      try {
        const { manager, browser } = harness;
        const soundId = manager.createSound(station, "node:n:video", mode);
        const refreshed = manager
          .refreshStreamUrl(soundId, "https://media.example/renewed.webm", 42)
          .catch((error: unknown) => error);
        const audio = browser.audio();
        audio.duration = 120;
        await flushMicrotasks();
        expect(audio.playPositions).toEqual([]);
        audio.emit("canplay");
        expect(await refreshed).toBeUndefined();

        expect(audio.playPositions).toEqual([42]);
        expect(manager.getSoundRadio(soundId)?.streamUrl).toBe(
          "https://media.example/renewed.webm"
        );
      } finally {
        harness.restore();
      }
    }
  );

  test("a paused URL renewal ignores its late abort through production callbacks", async () => {
    const harness = createMediaPlaybackHarness();
    try {
      const { manager, browser } = harness;
      const soundId = manager.createSound(station, "node:n:video", "native");
      const starting = manager.playSound(soundId);
      await flushMicrotasks();
      browser.audio().emit("canplay");
      await starting;
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => states.push(state));

      const refreshing = manager
        .refreshStreamUrl(soundId, "https://media.example/renewed.webm", 42)
        .catch((error: unknown) => error);
      await flushMicrotasks();
      manager.pauseSound(soundId);
      const stateCount = states.length;
      browser.audio().emit("abort");
      await refreshing;

      expect(states.slice(stateCount).some((state) => state.error)).toBe(false);
      expect(states.at(-1)).toMatchObject({
        error: null,
        isLoading: false,
        isPlaying: false,
      });
    } finally {
      harness.restore();
    }
  });

  test("a replaced recovery cannot seek the new source sharing its sound ID", async () => {
    const harness = createMediaPlaybackHarness();
    const graph = Promise.withResolvers<boolean>();
    try {
      const { manager, browser, effects } = harness;
      effects.connectGraph = mock(() =>
        Promise.resolve(true)
      ).mockImplementationOnce(() => graph.promise);
      const soundId = manager.createSound(station, "node:n:video");
      const refreshed = manager
        .refreshStreamUrl(soundId, "https://media.example/renewed.webm", 42)
        .catch((error: unknown) => error);
      const previous = browser.audio();
      previous.duration = 120;
      await flushMicrotasks();
      previous.emit("canplay");
      await flushMicrotasks();

      manager.createSound(
        { ...station, streamUrl: "https://media.example/replacement.webm" },
        soundId
      );
      const replacement = manager.playSound(soundId);
      const audio = browser.audio();
      audio.duration = 120;
      await flushMicrotasks();
      audio.emit("canplay");
      await replacement;
      graph.resolve(true);
      expect(await refreshed).toBeUndefined();

      expect(audio.currentTime).toBe(0);
      expect(audio.playPositions).toEqual([0]);
    } finally {
      graph.resolve(true);
      harness.restore();
    }
  });

  test("an active graph source's play rejection stops it and clears loading", async () => {
    const capture = createDeviceCaptureHarness();
    try {
      const { manager, context } = capture;
      const internals = manager as unknown as {
        ensurePlaybackSetup: () => Promise<void>;
        output: {
          getMainMeterSource: () => unknown;
          replaceContext: () => Promise<void>;
        };
      };
      internals.ensurePlaybackSetup = async () => undefined;
      internals.output.getMainMeterSource = () => context.createGain();
      internals.output.replaceContext = async () => undefined;
      const soundId = manager.createSound(station, "node:n:video");
      const instance = getRegistry(manager).get(soundId);
      if (!instance) {
        throw new Error("sound was not created");
      }
      const failure = new DOMException("Playback failed", "NotSupportedError");
      const pause = mock(() => undefined);
      instance.playbackSource = {
        ...createPendingSource(),
        pause,
        play: () => Promise.reject(failure),
      } as PlaybackSource;
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => states.push(state));

      await expect(manager.playSound(soundId)).rejects.toBe(failure);

      expect(pause).toHaveBeenCalledTimes(1);
      expect(instance.loading).toBe(false);
      expect(instance.playing).toBe(false);
      expect(states.at(-1)).toMatchObject({
        isBuffering: false,
        isLoading: false,
        isPlaying: false,
      });
    } finally {
      capture.restore();
    }
  });

  test.each(["stopSound", "cleanupSound", "cleanup"] as const)(
    "%s cancels pending capture before callbacks or graph connection",
    async (cancel) => {
      const capture = createDeviceCaptureHarness();
      try {
        const { manager } = capture;
        const soundId = manager.createSound(station, "node:n:mic");
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const start = manager.playDeviceSound(soundId, "usb-mic");
        const request = await capture.request();

        manager[cancel](soundId);
        const stateCount = states.length;
        const { stream, tracks } = capturedStream();
        request.resolve(stream);
        await start;

        expect(tracks.every((track) => track.readyState === "ended")).toBe(
          true
        );
        expect(states).toHaveLength(stateCount);
        expect(states.at(-1)).toMatchObject({
          isLoading: false,
          isPlaying: false,
        });
        expect(capture.context.createMediaStreamSource).not.toHaveBeenCalled();
        expect(capture.connectMain).not.toHaveBeenCalled();
        expect(manager.getDeviceSource(soundId)?.isActive ?? false).toBe(false);
      } finally {
        capture.restore();
      }
    }
  );

  test("a capture whose graph cannot connect fails instead of reading as live", async () => {
    const capture = createDeviceCaptureHarness();
    try {
      const { manager } = capture;
      const soundId = manager.createSound(station, "node:n:tab");
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => states.push(state));
      (
        manager as unknown as {
          connectAudioGraph: () => Promise<boolean>;
        }
      ).connectAudioGraph = async () => false;
      const { stream, tracks } = capturedStream("display");

      await expect(
        manager.playDeviceSound(soundId, "display", { stream })
      ).rejects.toThrow("could not connect to the mixer");

      expect(tracks.every((track) => track.readyState === "ended")).toBe(true);
      expect(manager.getDeviceSource(soundId)?.isActive ?? false).toBe(false);
      expect(states.at(-1)).toMatchObject({ isPlaying: false });
    } finally {
      capture.restore();
    }
  });

  test.each(["stopSound", "cleanupSound"] as const)(
    "%s cancels capture while audio initialization is pending",
    async (cancel) => {
      const capture = createDeviceCaptureHarness();
      try {
        const { manager } = capture;
        const pending = Promise.withResolvers<void>();
        manager.init = () => pending.promise;
        const soundId = manager.createSound(station, "node:n:mic");
        const start = manager.playDeviceSound(soundId, "usb-mic");

        manager[cancel](soundId);
        pending.resolve();
        await start;

        expect(capture.requests).toHaveLength(0);
        expect(manager.getDeviceSource(soundId)).toBeNull();
        expect(capture.connectMain).not.toHaveBeenCalled();
      } finally {
        capture.restore();
      }
    }
  );

  test.each(["resolve", "reject"] as const)(
    "a superseded capture's late %s leaves its replacement playing",
    async (settle) => {
      const capture = createDeviceCaptureHarness();
      try {
        const { manager } = capture;
        const soundId = manager.createSound(station, "dj:deck-a");
        const states: AudioState[] = [];
        manager.subscribe(soundId, (state) => states.push(state));
        const oldStart = manager.playDeviceSound(soundId, "old-mic");
        const oldRequest = await capture.request();
        const newStart = manager.playDeviceSound(soundId, "new-mic");
        const newRequest = await capture.request(1);
        const current = capturedStream("new-mic");
        newRequest.resolve(current.stream);
        await newStart;
        const stateCount = states.length;

        const old = capturedStream("old-mic");
        if (settle === "resolve") {
          oldRequest.resolve(old.stream);
        } else {
          oldRequest.reject(new DOMException("denied", "NotAllowedError"));
        }
        await oldStart;

        if (settle === "resolve") {
          expect(
            old.tracks.every((track) => track.readyState === "ended")
          ).toBe(true);
        }
        expect(
          current.tracks.every((track) => track.readyState === "live")
        ).toBe(true);
        expect(manager.getDeviceSource(soundId)?.currentDeviceId).toBe(
          "new-mic"
        );
        expect(manager.getDeviceSource(soundId)?.isActive).toBe(true);
        expect(states).toHaveLength(stateCount);
        expect(states.at(-1)).toMatchObject({ error: null, isPlaying: true });
        expect(capture.connectMain).toHaveBeenCalledTimes(1);
        expect(capture.context.createMediaStreamSource).toHaveBeenCalledTimes(
          1
        );
      } finally {
        capture.restore();
      }
    }
  );

  test("a stopped audio input stays muted through volume changes until it goes live", async () => {
    const capture = createDeviceCaptureHarness();
    try {
      const { manager } = capture;
      const soundId = manager.createSound(station, "node:n:mic");
      const start = manager.playDeviceSound(soundId, "usb-mic");
      (await capture.request()).resolve(capturedStream().stream);
      await start;
      const gain = getRegistry(manager).get(soundId)?.nodes?.gain
        .gain as unknown as FakeAudioParam;
      const lastGain = () => {
        const event = gain.events
          .filter((candidate) => candidate.type !== "cancel")
          .at(-1);
        return event && "value" in event ? event.value : null;
      };
      expect(lastGain()).toBe(1);
      manager.pauseSound(soundId);
      expect(lastGain()).toBe(0.0001);

      manager.setGlobalVolume(0.5);
      expect(lastGain()).toBe(0.0001);
      manager.setVolume(soundId, 0.8);
      expect(lastGain()).toBe(0.0001);
      manager.muteSound(soundId);
      manager.unmuteSound(soundId);
      expect(lastGain()).toBe(0.0001);
      expect(manager.getSoundVolume(soundId)).toBe(0.8);

      await manager.playSound(soundId, 0.8);
      expect(lastGain()).toBe(0.4);
      manager.setGlobalVolume(1);
      expect(lastGain()).toBe(0.8);
    } finally {
      capture.restore();
    }
  });

  test("pausing a sound that is still connecting settles its loading state", async () => {
    const manager = AudioManager.getInstance();
    const soundId = manager.createSound(
      {
        id: "station",
        name: "Station",
        streamUrl: "https://radio.example/station.mp3",
      },
      "single:single-a",
      "native"
    );
    const instance = getRegistry(manager).get(soundId);
    if (!instance) {
      throw new Error("sound was not created");
    }
    instance.playbackSource = createPendingSource();
    const states: AudioState[] = [];
    manager.subscribe(soundId, (state) => {
      states.push(state);
    });

    manager.playSound(soundId, 0.8).catch(() => undefined);
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({ isLoading: true, isPlaying: true });

    manager.pauseSound(soundId);

    expect(states.at(-1)).toMatchObject({ isLoading: false, isPlaying: false });
    expect(instance.loading).toBe(false);
  });

  test.each([true, false])(
    "a stream refresh reports playing only when its source plays on (%p)",
    async (playsOn) => {
      const manager = AudioManager.getInstance();
      const soundId = manager.createSound(providerTrack, "node:n:track");
      const instance = getRegistry(manager).get(soundId);
      if (!instance) {
        throw new Error("sound was not created");
      }
      instance.playbackSource = {
        ...createPendingSource(),
        refreshUrl: async () => playsOn,
      } as unknown as PlaybackSource;
      const states: AudioState[] = [];
      manager.subscribe(soundId, (state) => {
        states.push(state);
      });

      await manager.refreshStreamUrl(
        soundId,
        "https://radio.example/renewed.mp3",
        12
      );

      expect(states.at(-1)).toMatchObject({
        isLoading: false,
        isPlaying: playsOn,
      });
      expect(instance.playing).toBe(playsOn);
    }
  );

  test("a renewed stream load rejection retains its cause and promise reporting owner", async () => {
    const manager = AudioManager.getInstance();
    const soundId = manager.createSound(providerTrack, "node:n:track");
    const instance = getRegistry(manager).get(soundId);
    if (!instance) {
      throw new Error("sound was not created");
    }
    const failure = new Error("Renewed stream unavailable");
    instance.playbackSource = {
      ...createPendingSource(),
      refreshUrl: () => Promise.reject(failure),
    } as unknown as PlaybackSource;
    const states: AudioState[] = [];
    manager.subscribe(soundId, (state) => states.push(state));

    await expect(
      manager.refreshStreamUrl(soundId, "https://radio.example/renewed.mp3", 12)
    ).rejects.toBe(failure);

    expect(states.at(-1)?.error).toMatchObject({
      cause: failure,
      code: "STREAM_FETCH_FAILED",
      duringStart: true,
    });
    expect(instance.loading).toBe(false);
    expect(instance.playing).toBe(false);
  });

  test("without a connector, Single and DJ sounds connect to the main bus", async () => {
    const manager = AudioManager.getInstance();
    const graph = createGraphHarness(manager);
    const connector = mock<SoundOutputConnector>(() => () => undefined);
    manager.setSoundOutputConnector("node:n:station", connector);
    manager.createSound(station, "single:single-a");
    manager.createSound(station, "dj:deck-a");

    const single = await graph.connect("single:single-a");
    const dj = await graph.connect("dj:deck-a");

    expect(graph.connectMain.mock.calls).toEqual([
      [single.gain, false],
      [dj.gain, false],
    ]);
    expect(connector).not.toHaveBeenCalled();
  });

  test("with a connector, the lane's fader connects through it once", async () => {
    const manager = AudioManager.getInstance();
    const graph = createGraphHarness(manager);
    const disconnect = mock(() => undefined);
    const connector = mock<SoundOutputConnector>(() => disconnect);
    manager.setSoundOutputConnector("node:n:station", connector);
    manager.createSound(station, "node:n:station");

    const nodes = await graph.connect("node:n:station");

    expect(connector).toHaveBeenCalledTimes(1);
    const [source, realtime, connectMain] = connector.mock.calls[0] ?? [];
    expect(source).toBe(nodes.gain);
    expect(realtime).toBe(false);
    expect(graph.connectMain).not.toHaveBeenCalled();

    // The connector reaches the same main bus.
    const laneOut = nodes.preFaderSend;
    connectMain?.(laneOut, false);
    expect(graph.connectMain).toHaveBeenCalledWith(laneOut, false);

    manager.cleanupSound("node:n:station");
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test("clearing the connector restores the main bus on the next connect", async () => {
    const manager = AudioManager.getInstance();
    const graph = createGraphHarness(manager);
    const connector = mock<SoundOutputConnector>(() => () => undefined);
    manager.setSoundOutputConnector("node:n:station", connector);
    manager.setSoundOutputConnector("node:n:station", null);
    manager.createSound(station, "node:n:station");

    const nodes = await graph.connect("node:n:station");

    expect(connector).not.toHaveBeenCalled();
    expect(graph.connectMain).toHaveBeenCalledWith(nodes.gain, false);
  });
});
