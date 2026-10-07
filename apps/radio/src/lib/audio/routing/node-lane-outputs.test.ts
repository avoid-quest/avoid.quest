import { describe, expect, mock, test } from "bun:test";
import type { SoundOutputConnector } from "../manager/audio-manager-types";
import {
  createFakeFader,
  FakeAudioContext,
  type FakeGainNode,
} from "./fake-audio-nodes";
import { createNodeLaneOutputs, type LaneSinkRoute } from "./node-lane-outputs";
import { LANE_DUCK_MS, LANE_LEVEL_TIME_CONSTANT_S } from "./sends";

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
  /** Per lane, each cable's level, by cable id: a sink's id by default. */
  const levels = new Map<string, Map<string, number>>([
    ["kexp", new Map([["speakers", level]])],
  ]);
  /** A cable into a sink other than the one its id names. */
  const destinations = new Map<string, string>();
  /** Whether each lane hears a live input. */
  const realtime = new Set<string>();
  const setLevel = (
    laneId: string,
    sinkId: string,
    value: number,
    cableId = sinkId
  ) => {
    const lane = levels.get(laneId) ?? new Map<string, number>();
    lane.set(cableId, value);
    levels.set(laneId, lane);
    destinations.set(cableId, sinkId);
  };
  /** Where each sink's sends go; the main bus unless a test says. */
  const routes = new Map<string, Set<unknown>>();
  /** Which sink each send was routed for. */
  const sendSinks = new Map<FakeGainNode, string>();
  const mainSources = new Set<unknown>();
  const releaseMain = mock(() => undefined);
  const route = mock<LaneSinkRoute>((sinkId, send) => {
    sendSinks.set(send as unknown as FakeGainNode, sinkId);
    const into = routes.get(sinkId) ?? mainSources;
    into.add(send);
    return () => {
      if (into === mainSources) {
        releaseMain();
      }
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
    getSends: (laneId) =>
      new Map(
        [...(levels.get(laneId) ?? [])].map(([cableId, value]) => [
          `${laneId}>${cableId}`,
          {
            delay: 0,
            level: value,
            realtime: realtime.has(laneId),
            reenters: false,
            to: destinations.get(cableId) ?? cableId,
          },
        ])
      ),
    onConnect,
    route,
    wait,
  });
  const context = new FakeAudioContext();

  /** What AudioManager does inside connectAudioGraph, synchronously. */
  const connectSound = (soundId: string, into = context) => {
    const { fader, node } = createFakeFader(into);
    const connect = connectors.get(soundId);
    if (!connect) {
      throw new Error(`no connector for ${soundId}`);
    }
    const disconnect = connect(node, false, () => () => undefined);
    const laneOut = [...fader.connections][0] as FakeGainNode;
    const sendsTo = (sinkId: string) =>
      sendsOf(laneOut).filter((send) => sendSinks.get(send) === sinkId);
    const sendTo = (sinkId: string) => sendsTo(sinkId)[0];
    return { disconnect, fader, laneOut, sendsTo, sendTo };
  };

  const sendsOf = (laneOut: FakeGainNode) =>
    [...laneOut.connections] as FakeGainNode[];

  return {
    connectors,
    connectSound,
    context,
    host,
    levels,
    mainSources,
    outputs,
    realtime,
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
    expect(harness.route).toHaveBeenCalledWith("speakers", send, false);
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

    expect(onConnect).toHaveBeenCalledWith("kexp", harness.context);
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

  test("each cable gets its own send at its own level", () => {
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

  test("two cables into one sink get their own sends, each at its own level", () => {
    const harness = createHarness(1);
    harness.setLevel("kexp", "speakers", 0.25, "speakers again");
    harness.outputs.attach("kexp", "node:n:kexp");

    const { sendsTo } = harness.connectSound("node:n:kexp");
    const [first, second] = sendsTo("speakers");

    expect(sendsTo("speakers")).toHaveLength(2);
    expect(first?.gain.events.at(-1)).toMatchObject({ value: 1 });
    expect(second?.gain.events.at(-1)).toMatchObject({ value: 0.25 });
    expect(harness.mainSources.has(first)).toBe(true);
    expect(harness.mainSources.has(second)).toBe(true);

    // Muting one leaves the other.
    harness.setLevel("kexp", "speakers", 0, "speakers again");
    harness.outputs.refresh("kexp");
    expect(first?.gain.events.at(-1)).toMatchObject({ value: 1 });
    expect(second?.gain.events.at(-1)).toMatchObject({ value: 0 });
  });

  test("a lane that turns into a live input moves its sends off the main delay", () => {
    const harness = createHarness();
    harness.outputs.attach("kexp", "node:n:kexp");
    const { sendTo } = harness.connectSound("node:n:kexp");
    const delayed = sendTo("speakers");

    harness.realtime.add("kexp");
    harness.outputs.refresh("kexp");

    expect(delayed?.gain.events.at(-1)).toMatchObject({ value: 0 });
    expect(harness.route.mock.calls.map(([, , live]) => live)).toEqual([
      false,
      true,
    ]);
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

  test("a cable that goes fades its send out, then takes it off", async () => {
    const harness = createHarness();
    const desk = new Set<unknown>();
    harness.routes.set("desk", desk);
    harness.setLevel("kexp", "desk", 1);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut, sendTo } = harness.connectSound("node:n:kexp");
    const send = sendTo("desk");
    harness.context.currentTime = 4;

    harness.levels.get("kexp")?.delete("desk");
    harness.outputs.refresh("kexp");

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

  test("a cable replaced by one to another destination crossfades sends", async () => {
    const harness = createHarness();
    const desk = new Set<unknown>();
    harness.routes.set("desk", desk);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut, sendTo } = harness.connectSound("node:n:kexp");
    const before = sendTo("speakers");

    harness.levels.set("kexp", new Map([["desk", 1]]));
    harness.outputs.refresh("kexp");

    const after = sendTo("desk");
    expect(after).not.toBe(before);
    expect(desk.has(after)).toBe(true);
    expect(before?.gain.events.at(-1)).toMatchObject({ value: 0 });
    harness.waits.at(-1)?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(laneOut.connections.has(before)).toBe(false);
    expect(harness.mainSources.has(before)).toBe(false);
  });

  test("duck ramps laneOut to 0 over 20 ms and resolves once silent; unduck ramps it back", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { fader, laneOut, sendTo } = harness.connectSound("node:n:kexp");
    harness.context.currentTime = 10;
    let silent = false;

    const ducked = harness.outputs.duck("kexp")?.then(() => {
      silent = true;
    });

    expect(laneOut.gain.events.slice(-3)).toEqual([
      { time: 10, type: "cancel" },
      { time: 10, type: "set", value: 1 },
      { time: 10 + LANE_DUCK_MS / 1000, type: "linear", value: 0 },
    ]);
    expect(harness.wait).toHaveBeenLastCalledWith(LANE_DUCK_MS);

    // A cable change during the duck must not lift it.
    harness.outputs.refresh("kexp");
    expect(laneOut.gain.events.at(-1)?.type).toBe("linear");
    expect(sendTo("speakers")?.gain.events.at(-1)).toMatchObject({
      value: 0.7,
    });
    await Promise.resolve();
    expect(silent).toBe(false);

    harness.waits[0]?.resolve();
    await ducked;
    expect(silent).toBe(true);

    laneOut.gain.value = 0;
    harness.context.currentTime = 10.2;
    harness.outputs.unduck("kexp");

    expect(laneOut.gain.events.at(-1)).toEqual({
      time: 10.2 + LANE_DUCK_MS / 1000,
      type: "linear",
      value: 1,
    });
    expect(fader.gain.events).toEqual([]);
    expect(fader.gain.value).toBe(0.8);
  });

  test("a laneOut rebuilt on a new context during a duck starts silent", () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    harness.connectSound("node:n:kexp");
    harness.outputs.duck("kexp");

    const { laneOut } = harness.connectSound(
      "node:n:kexp",
      new FakeAudioContext()
    );
    expect(laneOut.gain.value).toBe(0);

    harness.outputs.unduck("kexp");
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });
  });

  test("a duck whose wait throws rejects, and unduck still lifts it", async () => {
    const harness = createHarness(0.7);
    harness.outputs.attach("kexp", "node:n:kexp");
    const { laneOut } = harness.connectSound("node:n:kexp");
    harness.wait.mockImplementationOnce(() => {
      throw new Error("no timer");
    });

    await expect(harness.outputs.duck("kexp")).rejects.toThrow("no timer");
    harness.outputs.unduck("kexp");

    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });
  });

  test("duck without a connected sound has nothing to wait for", () => {
    const harness = createHarness();

    expect(harness.outputs.duck("kexp")).toBeNull();
    harness.outputs.unduck("kexp");

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
    const ducked = harness.outputs.duck("kexp");
    harness.waits[0]?.resolve();
    await ducked;
    harness.outputs.unduck("kexp");
    harness.outputs.release("kexp");

    expect(fader.gain.events).toEqual([]);
    expect(fader.gain.value).toBe(0.8);
  });
});
