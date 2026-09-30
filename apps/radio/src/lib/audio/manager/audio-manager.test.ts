import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AudioState, PlaybackSource } from "../playback/index.js";
import { FakeAudioContext } from "../routing/fake-audio-nodes";
import type {
  AudioNodes,
  MainOutputConnect,
  SoundInstance,
  SoundOutputConnector,
} from "./audio-manager-types";
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
