import { describe, expect, mock, test } from "bun:test";
import type {
  MainOutputConnect,
  SoundOutputConnector,
} from "../manager/audio-manager-types";
import {
  createFakeFader,
  FakeAudioContext,
  type FakeGainNode,
} from "./fake-audio-nodes";
import {
  createNodeLaneOutputs,
  LANE_DUCK_MS,
  LANE_LEVEL_TIME_CONSTANT_S,
} from "./node-lane-outputs";

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve: () => resolve() };
}

function createHarness(level = 1) {
  const connectors = new Map<string, SoundOutputConnector>();
  const host = {
    setSoundOutputConnector: mock(
      (soundId: string, connect: SoundOutputConnector | null) => {
        if (connect) {
          connectors.set(soundId, connect);
        } else {
          connectors.delete(soundId);
        }
      }
    ),
  };
  const levels = new Map<string, number>([["kexp", level]]);
  const waits: Deferred[] = [];
  const outputs = createNodeLaneOutputs({
    getHost: () => host,
    getLevel: (laneId) => levels.get(laneId) ?? 0,
    wait: mock((_ms: number) => {
      const wait = deferred();
      waits.push(wait);
      return wait.promise;
    }),
  });
  const context = new FakeAudioContext();
  const mainSources = new Set<unknown>();
  const releaseMain = mock(() => undefined);
  const connectMain = mock<MainOutputConnect>((source) => {
    mainSources.add(source);
    return () => {
      releaseMain();
      mainSources.delete(source);
    };
  });

  /** What AudioManager does inside connectAudioGraph, synchronously. */
  const connectSound = (soundId: string) => {
    const { fader, node } = createFakeFader(context);
    const connect = connectors.get(soundId);
    if (!connect) {
      throw new Error(`no connector for ${soundId}`);
    }
    const disconnect = connect(node, false, connectMain);
    const laneOut = context.gains.at(-1) as FakeGainNode;
    return { disconnect, fader, laneOut };
  };

  return {
    connectMain,
    connectors,
    connectSound,
    context,
    host,
    levels,
    mainSources,
    outputs,
    releaseMain,
    waits,
  };
}

describe("createNodeLaneOutputs", () => {
  test("laneOut is built silent inside the connector, before any await", () => {
    const harness = createHarness(0.5);
    harness.outputs.attach("kexp", "node:n:kexp");

    expect(harness.host.setSoundOutputConnector).toHaveBeenCalledTimes(1);
    expect(harness.context.gains).toHaveLength(0);

    // No await between attach, the connect and these checks.
    const { fader, laneOut } = harness.connectSound("node:n:kexp");

    expect(fader.connections.has(laneOut)).toBe(true);
    expect(harness.connectMain).toHaveBeenCalledTimes(1);
    expect(harness.connectMain).toHaveBeenCalledWith(laneOut, false);
    expect(harness.mainSources.has(laneOut)).toBe(true);
    expect(laneOut.gain.value).toBe(0);
    expect(laneOut.gain.events.at(-1)).toEqual({
      time: 0,
      timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
      type: "target",
      value: 0.5,
    });
  });

  test("attach is a no-op for the attached sound, and laneOut is stable", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    harness.outputs.attach("kexp", "node:n:kexp");
    expect(harness.host.setSoundOutputConnector).toHaveBeenCalledTimes(1);

    const first = harness.connectSound("node:n:kexp");
    first.disconnect();
    expect(first.fader.connections.size).toBe(0);
    const second = harness.connectSound("node:n:kexp");

    expect(harness.context.gains).toHaveLength(1);
    expect(second.fader.connections.has(first.laneOut)).toBe(true);
  });

  test("refresh ramps laneOut to the current level with τ 5 ms", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");
    harness.context.currentTime = 3;
    harness.levels.set("kexp", 0);

    harness.outputs.refresh("kexp");

    expect(laneOut.gain.events.slice(-3)).toEqual([
      { time: 3, type: "cancel" },
      { time: 3, type: "set", value: 0 },
      {
        time: 3,
        timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
        type: "target",
        value: 0,
      },
    ]);
  });

  test("swap ducks over 20 ms, replaces once silent, awaits it, then ramps back", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { fader, laneOut } = harness.connectSound("node:n:kexp");
    laneOut.gain.value = 0.7;
    harness.context.currentTime = 10;
    const outcome = deferred();
    const replace = mock(async () => {
      await outcome.promise;
      return "ready";
    });

    const swapped = harness.outputs.swap("kexp", replace);

    expect(laneOut.gain.events.slice(-3)).toEqual([
      { time: 10, type: "cancel" },
      { time: 10, type: "set", value: 0.7 },
      { time: 10 + LANE_DUCK_MS / 1000, type: "linear", value: 0 },
    ]);
    expect(replace).not.toHaveBeenCalled();

    // A cable change during the duck must not lift it.
    harness.outputs.refresh("kexp");
    expect(laneOut.gain.events.at(-1)?.type).toBe("linear");

    harness.waits[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replace).toHaveBeenCalledTimes(1);
    const eventsWhileReplacing = laneOut.gain.events.length;

    laneOut.gain.value = 0;
    harness.context.currentTime = 10.2;
    outcome.resolve();
    expect(await swapped).toBe("ready");

    expect(laneOut.gain.events.length).toBe(eventsWhileReplacing + 3);
    expect(laneOut.gain.events.at(-1)).toEqual({
      time: 10.2 + LANE_DUCK_MS / 1000,
      type: "linear",
      value: 0.7,
    });
    expect(fader.gain.events).toEqual([]);
    expect(fader.gain.value).toBe(0.8);
  });

  test("a failed replace still ramps back", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");

    const swapped = harness.outputs.swap("kexp", () =>
      Promise.reject(new Error("tree failed"))
    );
    harness.waits[0]?.resolve();

    await expect(swapped).rejects.toThrow("tree failed");
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 0.7,
    });
  });

  test("overlapping swaps hold the duck until the last one ends", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");

    const first = harness.outputs.swap("kexp", async () => undefined);
    const second = harness.outputs.swap("kexp", async () => undefined);
    harness.waits[0]?.resolve();
    await first;

    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 0,
    });

    harness.waits[1]?.resolve();
    await second;
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 0.7,
    });
  });

  test("swap without a connected sound replaces at once", async () => {
    const harness = createHarness();
    const replace = mock(async () => "ready");

    expect(await harness.outputs.swap("kexp", replace)).toBe("ready");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(harness.waits).toHaveLength(0);
  });

  test("release unregisters the connector and takes laneOut off the bus", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");

    harness.outputs.release("kexp");

    expect(harness.host.setSoundOutputConnector).toHaveBeenLastCalledWith(
      "node:n:kexp",
      null
    );
    expect(harness.connectors.size).toBe(0);
    expect(harness.releaseMain).toHaveBeenCalledTimes(1);
    expect(harness.mainSources.has(laneOut)).toBe(false);
  });

  test("dispose releases every lane", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    harness.outputs.attach("nts", "node:n:nts");

    harness.outputs.dispose();

    expect(harness.connectors.size).toBe(0);
  });

  test("the fader is never written by node code", async () => {
    const harness = createHarness(0.4);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { fader } = harness.connectSound("node:n:kexp");

    harness.levels.set("kexp", 0);
    harness.outputs.refresh("kexp");
    const swapped = harness.outputs.swap("kexp", async () => undefined);
    harness.waits[0]?.resolve();
    await swapped;
    harness.outputs.release("kexp");

    expect(fader.gain.events).toEqual([]);
    expect(fader.gain.value).toBe(0.8);
  });
});
