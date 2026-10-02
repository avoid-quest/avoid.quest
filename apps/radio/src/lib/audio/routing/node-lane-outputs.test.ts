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
  type LaneSinkRoute,
} from "./node-lane-outputs";

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve: () => resolve() };
}

function createHarness(level = 1, onConnect?: (laneId: string) => void) {
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
  /** Per lane, the level into each sink. */
  const levels = new Map<string, Map<string, number>>([
    ["kexp", new Map([["speakers", level]])],
  ]);
  const setLevel = (laneId: string, sinkId: string, value: number) => {
    const lane = levels.get(laneId) ?? new Map<string, number>();
    lane.set(sinkId, value);
    levels.set(laneId, lane);
  };
  /** Where each sink's sends go; the main bus unless a test says. */
  const routes = new Map<string, Set<unknown>>();
  /** Which sink each send was routed for. */
  const sendSinks = new Map<FakeGainNode, string>();
  const route = mock<LaneSinkRoute>((sinkId, send, toMain) => {
    sendSinks.set(send as unknown as FakeGainNode, sinkId);
    const into = routes.get(sinkId);
    if (!into) {
      return toMain();
    }
    into.add(send);
    return () => {
      into.delete(send);
    };
  });
  const waits: Deferred[] = [];
  const wait = mock((_ms: number) => {
    const pending = deferred();
    waits.push(pending);
    return pending.promise;
  });
  const outputs = createNodeLaneOutputs({
    getHost: () => host,
    getLevels: (laneId) => levels.get(laneId) ?? new Map(),
    onConnect,
    route,
    wait,
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
    const laneOut = [...fader.connections][0] as FakeGainNode;
    const sendTo = (sinkId: string) =>
      sendsOf(laneOut).find((send) => sendSinks.get(send) === sinkId);
    return { disconnect, fader, laneOut, sendTo };
  };

  const sendsOf = (laneOut: FakeGainNode) =>
    [...laneOut.connections] as FakeGainNode[];

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
    route,
    routes,
    setLevel,
    wait,
    waits,
  };
}

describe("createNodeLaneOutputs", () => {
  test("laneOut and its sends are built silent inside the connector, before any await", () => {
    const harness = createHarness(0.5);
    harness.outputs.attach("kexp", "node:n:kexp");

    expect(harness.host.setSoundOutputConnector).toHaveBeenCalledTimes(1);
    expect(harness.context.gains).toHaveLength(0);

    // No await between attach, the connect and these checks.
    const { fader, laneOut, sendTo } = harness.connectSound("node:n:kexp");
    const send = sendTo("speakers");

    expect(fader.connections.has(laneOut)).toBe(true);
    expect(laneOut.gain.value).toBe(1);
    expect(send).toBeDefined();
    expect(harness.connectMain).toHaveBeenCalledTimes(1);
    expect(harness.connectMain).toHaveBeenCalledWith(send, false);
    expect(harness.mainSources.has(send)).toBe(true);
    expect(send?.gain.value).toBe(0);
    expect(send?.gain.events.at(-1)).toEqual({
      time: 0,
      timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
      type: "target",
      value: 0.5,
    });
  });

  test("onConnect runs for the lane as its sound connects", () => {
    const onConnect = mock((_laneId: string) => undefined);
    const harness = createHarness(1, onConnect);
    harness.outputs.attach("kexp", "node:n:kexp");
    expect(onConnect).not.toHaveBeenCalled();

    harness.connectSound("node:n:kexp");

    expect(onConnect).toHaveBeenCalledWith("kexp");
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

    // laneOut and its Speakers send, built once.
    expect(harness.context.gains).toHaveLength(2);
    expect(second.fader.connections.has(first.laneOut)).toBe(true);
  });

  test("each sink gets its own send, whose gain is the sum of its own cables", () => {
    const harness = createHarness(1.5);
    harness.routes.set("desk", new Set());
    harness.setLevel("kexp", "desk", 0.25);
    harness.outputs.attach("kexp", "node:n:kexp");

    const { sendTo } = harness.connectSound("node:n:kexp");
    const speakers = sendTo("speakers");
    const desk = sendTo("desk");

    expect(speakers?.gain.events.at(-1)).toMatchObject({ value: 1.5 });
    expect(desk?.gain.events.at(-1)).toMatchObject({ value: 0.25 });
    expect(harness.mainSources.has(speakers)).toBe(true);
    expect(harness.mainSources.has(desk)).toBe(false);
    expect(harness.routes.get("desk")?.has(desk)).toBe(true);
  });

  test("refresh ramps each send to its current level with τ 5 ms", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut, sendTo } = harness.connectSound("node:n:kexp");
    const send = sendTo("speakers");
    harness.context.currentTime = 3;
    harness.setLevel("kexp", "speakers", 0);

    harness.outputs.refresh("kexp");

    expect(send?.gain.events.slice(-3)).toEqual([
      { time: 3, type: "cancel" },
      { time: 3, type: "set", value: 0 },
      {
        time: 3,
        timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
        type: "target",
        value: 0,
      },
    ]);
    expect(laneOut.gain.events).toEqual([]);
  });

  test("refresh holds a send's ramp in flight with cancelAndHoldAtTime", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    const { sendTo } = harness.connectSound("node:n:kexp");
    const send = sendTo("speakers") as FakeGainNode;
    const cancelAndHoldAtTime = mock((time: number) => {
      send.gain.events.push({ time, type: "cancel" });
    });
    Object.assign(send.gain, { cancelAndHoldAtTime });
    harness.context.currentTime = 3;

    harness.outputs.refresh("kexp");

    expect(cancelAndHoldAtTime).toHaveBeenCalledWith(3);
    expect(send.gain.events.slice(-2)).toEqual([
      { time: 3, type: "cancel" },
      {
        time: 3,
        timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
        type: "target",
        value: 1,
      },
    ]);
  });

  test("without cancelAndHoldAtTime, refresh reads a send's value before canceling", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    const { sendTo } = harness.connectSound("node:n:kexp");
    const param = (sendTo("speakers") as FakeGainNode).gain;
    param.value = 0.4;
    // Canceling drops the ramp, so the param would read its last set point.
    const cancel = param.cancelScheduledValues.bind(param);
    param.cancelScheduledValues = (time) => {
      cancel(time);
      param.value = 0;
    };
    harness.context.currentTime = 3;

    harness.outputs.refresh("kexp");

    expect(param.events.slice(-2, -1)).toEqual([
      { time: 3, type: "set", value: 0.4 },
    ]);
  });

  test("a sink the lane stops reaching fades its send to 0", () => {
    const harness = createHarness();
    harness.routes.set("desk", new Set());
    harness.setLevel("kexp", "desk", 1);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { sendTo } = harness.connectSound("node:n:kexp");

    harness.levels.get("kexp")?.delete("desk");
    harness.outputs.refresh("kexp");

    expect(sendTo("desk")?.gain.events.at(-1)).toMatchObject({
      type: "target",
      value: 0,
    });
  });

  test("reroute moves a sink's sends to where the route now says", () => {
    const harness = createHarness();
    const desk = new Set<unknown>();
    harness.routes.set("desk", desk);
    harness.setLevel("kexp", "desk", 1);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { sendTo } = harness.connectSound("node:n:kexp");
    const send = sendTo("desk");
    expect(desk.has(send)).toBe(true);

    // The device sink failed: its sends go to Speakers.
    harness.routes.delete("desk");
    harness.outputs.reroute("desk");

    expect(desk.has(send)).toBe(false);
    expect(harness.mainSources.has(send)).toBe(true);
  });

  test("dropSink fades a removed sink's sends out, then takes them off it", async () => {
    const harness = createHarness();
    const desk = new Set<unknown>();
    harness.routes.set("desk", desk);
    harness.setLevel("kexp", "desk", 1);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut, sendTo } = harness.connectSound("node:n:kexp");
    const send = sendTo("desk");
    harness.context.currentTime = 4;

    harness.outputs.dropSink("desk");

    // Still wired while it fades, so it doesn't click.
    expect(send?.gain.events.at(-1)).toEqual({
      time: 4,
      timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
      type: "target",
      value: 0,
    });
    expect(desk.size).toBe(1);
    expect(laneOut.connections.has(send)).toBe(true);
    // Unwired only once the tail is under 0.5% (about -46 dB).
    const dropMs = harness.wait.mock.calls.at(-1)?.[0] ?? 0;
    expect(
      Math.exp(-dropMs / 1000 / LANE_LEVEL_TIME_CONSTANT_S)
    ).toBeLessThanOrEqual(0.005);

    harness.waits.at(-1)?.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(desk.size).toBe(0);
    expect(laneOut.connections.has(send)).toBe(false);
  });

  test("swap ducks laneOut over 20 ms, replaces once silent, awaits it, then ramps back", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { fader, laneOut, sendTo } = harness.connectSound("node:n:kexp");
    harness.context.currentTime = 10;
    const outcome = deferred();
    const replace = mock(async () => {
      await outcome.promise;
      return "ready";
    });

    const swapped = harness.outputs.swap("kexp", replace);

    expect(laneOut.gain.events.slice(-3)).toEqual([
      { time: 10, type: "cancel" },
      { time: 10, type: "set", value: 1 },
      { time: 10 + LANE_DUCK_MS / 1000, type: "linear", value: 0 },
    ]);
    expect(replace).not.toHaveBeenCalled();

    // A cable change during the duck must not lift it.
    harness.outputs.refresh("kexp");
    expect(laneOut.gain.events.at(-1)?.type).toBe("linear");
    expect(sendTo("speakers")?.gain.events.at(-1)).toMatchObject({
      value: 0.7,
    });

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
      value: 1,
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
      value: 1,
    });
  });

  test("a duck whose wait throws still lifts, and the next swap ducks again", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");
    harness.wait.mockImplementationOnce(() => {
      throw new Error("no timer");
    });
    const replace = mock(async () => "ready");

    await expect(harness.outputs.swap("kexp", replace)).rejects.toThrow(
      "no timer"
    );
    expect(replace).not.toHaveBeenCalled();
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });

    const next = harness.outputs.swap("kexp", replace);
    expect(harness.waits).toHaveLength(1);
    harness.waits[0]?.resolve();
    expect(await next).toBe("ready");
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });
  });

  test("overlapping swaps hold the duck until the last one ends", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");

    const outcome = deferred();
    const first = harness.outputs.swap("kexp", async () => undefined);
    const second = harness.outputs.swap("kexp", () => outcome.promise);
    harness.waits[0]?.resolve();
    await first;

    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 0,
    });

    outcome.resolve();
    await second;
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });
  });

  test("a swap started mid-duck replaces once that duck is silent, not before", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");
    harness.context.currentTime = 10;
    const firstReplace = mock(async () => undefined);
    const secondReplace = mock(async () => undefined);

    const first = harness.outputs.swap("kexp", firstReplace);
    const ducked = laneOut.gain.events.length;
    harness.context.currentTime = 10.005;
    const second = harness.outputs.swap("kexp", secondReplace);

    // The duck in flight keeps its deadline; the second swap waits on it.
    expect(laneOut.gain.events).toHaveLength(ducked);
    expect(harness.waits).toHaveLength(1);
    expect(firstReplace).not.toHaveBeenCalled();
    expect(secondReplace).not.toHaveBeenCalled();

    harness.waits[0]?.resolve();
    await Promise.all([first, second]);

    expect(firstReplace).toHaveBeenCalledTimes(1);
    expect(secondReplace).toHaveBeenCalledTimes(1);
    expect(
      laneOut.gain.events.filter(
        (event) => event.type === "linear" && event.value === 0
      )
    ).toHaveLength(1);
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });
  });

  test("a swap after the duck lifted ducks again", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    harness.connectSound("node:n:kexp");

    const first = harness.outputs.swap("kexp", async () => undefined);
    harness.waits[0]?.resolve();
    await first;
    const second = harness.outputs.swap("kexp", async () => undefined);

    expect(harness.waits).toHaveLength(2);
    harness.waits[1]?.resolve();
    await second;
  });

  test("swap without a connected sound replaces at once", async () => {
    const harness = createHarness();
    const replace = mock(async () => "ready");

    expect(await harness.outputs.swap("kexp", replace)).toBe("ready");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(harness.waits).toHaveLength(0);
  });

  test("release unregisters the connector and takes every send off its sink", () => {
    const harness = createHarness();
    const desk = new Set<unknown>();
    harness.routes.set("desk", desk);
    harness.setLevel("kexp", "desk", 1);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { sendTo } = harness.connectSound("node:n:kexp");

    harness.outputs.release("kexp");

    expect(harness.host.setSoundOutputConnector).toHaveBeenLastCalledWith(
      "node:n:kexp",
      null
    );
    expect(harness.connectors.size).toBe(0);
    expect(harness.releaseMain).toHaveBeenCalledTimes(1);
    expect(harness.mainSources.has(sendTo("speakers"))).toBe(false);
    expect(desk.size).toBe(0);
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

    harness.setLevel("kexp", "speakers", 0);
    harness.outputs.refresh("kexp");
    const swapped = harness.outputs.swap("kexp", async () => undefined);
    harness.waits[0]?.resolve();
    await swapped;
    harness.outputs.release("kexp");

    expect(fader.gain.events).toEqual([]);
    expect(fader.gain.value).toBe(0.8);
  });
});
