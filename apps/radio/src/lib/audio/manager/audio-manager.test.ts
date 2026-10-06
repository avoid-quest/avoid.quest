import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AudioState, PlaybackSource } from "../playback/index.js";
import {
  FakeAudioContext,
  type FakeAudioParam,
} from "../routing/fake-audio-nodes";
import { createPlaybackSourceCallbacks } from "./audio-manager-source-callbacks";
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

afterEach(() => {
  AudioManager.resetInstance();
});

describe("AudioManager", () => {
  test("startup cleanup does not announce an ended track to playlist listeners", () => {
    const manager = AudioManager.getInstance();
    const soundId = manager.createSound(station, "node:n:video");
    const instance = getRegistry(manager).get(soundId);
    if (!instance) {
      throw new Error("sound was not created");
    }
    const states: AudioState[] = [];
    const callbacks = createPlaybackSourceCallbacks({
      instance,
      notifyListeners: (_id, state) => states.push(state),
      soundId,
    });
    instance.playbackSource = {
      ...createPendingSource(),
      stop: () => callbacks.onEnded?.(),
    } as PlaybackSource;
    manager.subscribe(soundId, (state) => states.push(state));

    (
      manager as unknown as {
        rollbackEarlyPlayback: (
          id: string,
          sound: SoundInstance,
          source: PlaybackSource | null
        ) => void;
      }
    ).rollbackEarlyPlayback(soundId, instance, null);

    expect(states.some((state) => state.hasEnded)).toBe(false);
    expect(instance.playbackSource).toBeNull();
    expect(states.at(-1)).toMatchObject({
      isLoading: false,
      isPlaying: false,
    });
  });

  test("a renewed URL can restart a source removed after startup failure", async () => {
    const manager = AudioManager.getInstance();
    const soundId = manager.createSound(station, "node:n:video");
    const instance = getRegistry(manager).get(soundId);
    if (!instance) {
      throw new Error("sound was not created");
    }
    const play = mock(() => {
      instance.playing = true;
      instance.playbackSource = createPendingSource();
      return Promise.resolve();
    });
    manager.playSound = play;

    await manager.refreshStreamUrl(
      soundId,
      "https://media.example/renewed.webm",
      0,
      "progressive"
    );

    expect(play).toHaveBeenCalledWith(soundId, instance.volume);
    expect(instance.radio.streamUrl).toBe("https://media.example/renewed.webm");
    expect(instance.playing).toBe(true);
  });

  test("a graph playback rejection stops the source and clears loading", async () => {
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
      const soundId = manager.createSound(station, "node:n:track");
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
    const soundId = manager.createSound(station, "node:n:track");
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
