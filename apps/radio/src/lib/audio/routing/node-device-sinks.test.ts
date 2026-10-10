import { describe, expect, mock, test } from "bun:test";
import { FakeAudioContext, type FakeGainNode } from "./fake-audio-nodes";
import {
  createNodeDeviceSinks,
  type NodeOutputPlan,
} from "./node-device-sinks";

/** An `<audio>` element that records its sink and whether it plays. */
class FakeAudioElement {
  sinkId = "";
  srcObject: unknown = null;
  volume = 0;
  paused = true;
  rejectSink: Error | null = null;

  setSinkId = mock((deviceId: string) => {
    if (this.rejectSink) {
      return Promise.reject(this.rejectSink);
    }
    this.sinkId = deviceId;
    return Promise.resolve();
  });

  play = mock(() => {
    this.paused = false;
    return Promise.resolve();
  });

  pause = mock(() => {
    this.paused = true;
  });
}

function createHarness({
  supported = true,
  ids = ["default", "usb", "hdmi"],
  createElement,
}: {
  supported?: boolean;
  ids?: string[];
  createElement?: () => FakeAudioElement;
} = {}) {
  const elements: FakeAudioElement[] = [];
  const context = new FakeAudioContext();
  const devices = { ids };
  const mainSources = new Map<unknown, boolean>();
  let hotPlug: (() => void) | null = null;
  const onStatus = mock(() => undefined);
  const sinks = createNodeDeviceSinks({
    connectMain: (node, realtime) => {
      mainSources.set(node, realtime);
      return () => {
        mainSources.delete(node);
      };
    },
    createElement: () => {
      const element = createElement?.() ?? new FakeAudioElement();
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
    isSupported: () => supported,
    listOutputDeviceIds: async () => devices.ids,
    onStatus,
    watchDevices: (onChange) => {
      hotPlug = onChange;
      return () => {
        hotPlug = null;
      };
    },
  });
  const send = (from = context) => from.createGain() as unknown as FakeGainNode;
  const connect = (sinkId: string, from = send(), realtime = false) => ({
    release: sinks.connect(sinkId, from as unknown as AudioNode, realtime),
    send: from,
  });
  /** The Output node gain a send plays through. */
  const gainOf = (from: FakeGainNode) =>
    [...from.connections][0] as FakeGainNode | undefined;
  /** Where a send plays: a device's element, the main bus, or nowhere. */
  const whereIs = (from: FakeGainNode): string => {
    const gain = gainOf(from);
    if (!gain) {
      return "unconnected";
    }
    if (mainSources.has(gain)) {
      return "speakers";
    }
    const [input] = [...gain.connections] as (FakeGainNode | undefined)[];
    const [destination] = [...(input?.connections ?? [])];
    const element = elements.find(
      (candidate) =>
        candidate.srcObject !== null &&
        candidate.srcObject ===
          (destination as { stream?: unknown } | undefined)?.stream
    );
    return element ? `device:${element.sinkId || "pending"}` : "nowhere";
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    connect,
    context,
    devices,
    elements,
    gainOf,
    hotPlug: () => hotPlug?.(),
    mainSources,
    onStatus,
    send,
    settle,
    // At unity master unless a test sets one.
    sinks: {
      ...sinks,
      sync: (outputs: ReadonlyMap<string, NodeOutputPlan>, master = 1) =>
        sinks.sync(outputs, master),
    },
    whereIs,
  };
}

function devicesOf(entries: [string, string | null][]) {
  return new Map(
    entries.map(([sinkId, deviceId]) => [sinkId, { deviceId, muted: false }])
  );
}

describe("createNodeDeviceSinks", () => {
  test("several Output device nodes share one device, each with its own mute", async () => {
    const h = createHarness();
    h.sinks.sync(
      devicesOf([
        ["one", "usb"],
        ["two", "usb"],
      ])
    );
    const one = h.connect("one");
    const two = h.connect("two");
    await h.settle();

    expect([h.whereIs(one.send), h.whereIs(two.send)]).toEqual([
      "device:usb",
      "device:usb",
    ]);
    expect(h.elements).toHaveLength(1);
    expect(h.gainOf(one.send)).not.toBe(h.gainOf(two.send));

    // Muting one leaves the other's level alone.
    h.sinks.sync(
      new Map([
        ["one", { deviceId: "usb", muted: true }],
        ["two", { deviceId: "usb", muted: false }],
      ])
    );
    expect(h.gainOf(one.send)?.gain.events.at(-1)).toMatchObject({
      type: "target",
      value: 0,
    });
    expect(h.gainOf(two.send)?.gain.events.at(-1)).toMatchObject({
      type: "target",
      value: 1,
    });

    // Removing one leaves the other playing on the same element, no gap.
    one.release();
    h.sinks.sync(devicesOf([["two", "usb"]]));
    expect(h.elements[0]?.paused).toBe(false);
    expect(h.whereIs(two.send)).toBe("device:usb");
    expect(h.sinks.status("one")).toBeUndefined();
    expect(h.sinks.status("two")).toEqual({ state: "ok" });

    // Unplugging the device moves every node on it to Speakers.
    h.sinks.sync(
      devicesOf([
        ["two", "usb"],
        ["three", "usb"],
      ])
    );
    const three = h.connect("three");
    h.devices.ids = ["default"];
    h.hotPlug();
    await h.settle();
    expect([h.whereIs(two.send), h.whereIs(three.send)]).toEqual([
      "speakers",
      "speakers",
    ]);
    expect(h.sinks.statuses()).toEqual({
      three: { state: "unplugged" },
      two: { state: "unplugged" },
    });
    h.sinks.dispose();
  });

  test("a send plays through its node's gain and a MediaStream hop into an <audio> set to the device", async () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    const { send } = h.connect("desk");
    await h.settle();

    const [element] = h.elements;
    const [destination] = h.context.destinations;
    expect(h.whereIs(send)).toBe("device:usb");
    expect(element?.srcObject).toBe(destination?.stream);
    expect(element?.paused).toBe(false);
    expect(h.sinks.status("desk")).toEqual({ state: "ok" });
  });

  test("Speakers play on the main bus through their node's gain, one per timing", () => {
    const h = createHarness();
    h.sinks.sync(new Map([["out", { muted: false }]]));
    const delayed = h.connect("out");
    const live = h.connect("out", h.send(), true);

    expect(h.whereIs(delayed.send)).toBe("speakers");
    expect(h.whereIs(live.send)).toBe("speakers");
    expect(h.mainSources.get(h.gainOf(delayed.send))).toBe(false);
    expect(h.mainSources.get(h.gainOf(live.send))).toBe(true);
    expect(h.gainOf(delayed.send)?.gain.value).toBe(1);
    expect(h.sinks.statuses()).toEqual({});
  });

  test("replacing an Output device with Speakers publishes the statuses again", () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", null]]));
    h.onStatus.mockClear();

    h.sinks.sync(new Map([["out", { muted: false }]]));

    expect(h.onStatus).toHaveBeenCalled();
    expect(h.sinks.statuses()).toEqual({});
  });

  test("an Output node's gain keeps the master level within 0–1", () => {
    const h = createHarness();
    const speakers = new Map([["out", { muted: false }]]);
    h.sinks.sync(speakers, 3);
    const { send } = h.connect("out");
    expect(h.gainOf(send)?.gain.value).toBe(1);

    h.sinks.sync(speakers, -0.5);
    expect(h.gainOf(send)?.gain.events.at(-1)).toMatchObject({ value: 0 });
  });

  test("every send into one node shares its gain and graph", () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));

    const one = h.connect("desk");
    const two = h.connect("desk");

    expect(h.gainOf(one.send)).toBe(h.gainOf(two.send));
    expect(h.elements).toHaveLength(1);
    expect(h.context.destinations).toHaveLength(1);
  });

  test("a send from a new AudioContext gets a new gain and graph on it", async () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    h.connect("desk");
    await h.settle();
    const [oldElement] = h.elements;
    const [oldDestination] = h.context.destinations;

    const fresh = new FakeAudioContext();
    const { send } = h.connect("desk", h.send(fresh));
    await h.settle();

    expect(oldElement?.paused).toBe(true);
    expect(oldDestination?.stopped).toEqual([true]);
    expect(h.whereIs(send)).toBe("device:usb");
    expect(h.gainOf(send)?.context).toBe(fresh);
    expect(fresh.destinations).toHaveLength(1);
  });

  test("an Output device with no device picked plays nowhere", () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", null]]));

    expect(h.whereIs(h.connect("desk").send)).toBe("nowhere");
    expect(h.sinks.status("desk")).toEqual({ state: "empty" });
  });

  test("without setSinkId every sink plays through Speakers", () => {
    const h = createHarness({ supported: false });
    h.sinks.sync(devicesOf([["desk", "usb"]]));

    expect(h.whereIs(h.connect("desk").send)).toBe("speakers");
    expect(h.sinks.status("desk")).toEqual({ state: "unsupported" });
    expect(h.elements).toHaveLength(0);
  });

  test("a rejected setSinkId marks the sink failed and moves its gain to Speakers", async () => {
    const h = createHarness({
      createElement: () => {
        const element = new FakeAudioElement();
        element.rejectSink = new Error("Permission denied");
        return element;
      },
    });
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    const { send } = h.connect("desk");
    await h.settle();

    expect(h.sinks.status("desk")).toEqual({
      message: "Permission denied",
      state: "failed",
    });
    expect(h.elements[0]?.srcObject).toBeNull();
    expect(h.whereIs(send)).toBe("speakers");
  });

  test("an unplugged device fails over to Speakers and comes back when plugged in", async () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    await h.settle();
    const { send } = h.connect("desk");
    await h.settle();
    const [element] = h.elements;

    h.devices.ids = ["default", "hdmi"];
    h.hotPlug();
    await h.settle();

    expect(h.sinks.status("desk")).toEqual({ state: "unplugged" });
    expect(element?.pause).toHaveBeenCalled();
    expect(h.whereIs(send)).toBe("speakers");

    h.devices.ids = ["default", "hdmi", "usb"];
    h.hotPlug();
    await h.settle();

    expect(h.sinks.status("desk")).toEqual({ state: "ok" });
    expect(h.whereIs(send)).toBe("device:usb");
  });

  test.each(["remove", "replace", "dispose"] as const)(
    "a pending retry cannot play after %s invalidates its output",
    async (action) => {
      const attempt = Promise.withResolvers<void>();
      let made = 0;
      const h = createHarness({
        createElement: () => {
          const element = new FakeAudioElement();
          if (made === 0) {
            element.rejectSink = new Error("Permission denied");
          } else if (made === 1) {
            element.setSinkId = mock(() => attempt.promise);
          }
          made += 1;
          return element;
        },
      });
      h.sinks.sync(devicesOf([["desk", "usb"]]));
      const { release } = h.connect("desk");
      await h.settle();
      h.sinks.retry("desk");

      if (action === "dispose") {
        h.sinks.dispose();
      } else {
        release();
        h.sinks.sync(devicesOf(action === "replace" ? [["desk", "hdmi"]] : []));
      }
      attempt.resolve();
      await h.settle();

      expect(h.elements[1]?.play).not.toHaveBeenCalled();
      expect(h.elements[1]?.srcObject).toBeNull();
      expect(h.context.destinations[1]?.stopped).toEqual([true]);
      expect(h.sinks.status("desk")).toEqual(
        action === "replace" ? { state: "ok" } : undefined
      );
      h.sinks.retry("desk");
      expect(h.elements).toHaveLength(2);
    }
  );

  test("a device list without ids (no permission yet) unplugs nothing", async () => {
    const h = createHarness({ ids: ["", ""] });
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    await h.settle();

    expect(h.sinks.status("desk")).toEqual({ state: "ok" });
  });

  test("a removed Output device keeps its gain and device until its cables let go", async () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    const { release, send } = h.connect("desk");
    await h.settle();
    const [element] = h.elements;
    const [destination] = h.context.destinations;

    h.sinks.sync(new Map());

    // Its cable is still fading out: it plays on, through the same gain.
    expect(h.whereIs(send)).toBe("device:usb");
    expect(element?.paused).toBe(false);
    expect(h.sinks.status("desk")).toBeUndefined();
    // A new cable can't reach a node that left the plan.
    const late = h.connect("missing");
    expect(h.whereIs(late.send)).toBe("unconnected");

    const gain = h.gainOf(send);
    release();

    expect(gain?.connections.size).toBe(0);
    expect(element?.pause).toHaveBeenCalled();
    expect(element?.srcObject).toBeNull();
    expect(destination?.stopped).toEqual([true]);
  });

  test("a removed Output node's gain follows the master with its own mute", () => {
    const h = createHarness();
    h.sinks.sync(
      new Map([
        ["desk", { deviceId: "usb", muted: false }],
        ["booth", { deviceId: "usb", muted: true }],
      ]),
      0.8
    );
    const desk = h.connect("desk");
    const booth = h.connect("booth");

    // Both leave the plan while their cables still fade into them.
    h.sinks.sync(new Map(), 0.3);

    expect(h.gainOf(desk.send)?.gain.events.at(-1)).toMatchObject({
      type: "target",
      value: 0.3,
    });
    expect(h.gainOf(booth.send)?.gain.events.at(-1)).toMatchObject({
      type: "target",
      value: 0,
    });
  });

  test("a muted Output device mutes the cables still fading into it", () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    const fading = h.connect("desk");

    // The plan drops the cable while the node is muted: it fades out muted.
    h.sinks.sync(new Map([["desk", { deviceId: "usb", muted: true }]]));

    expect(h.gainOf(fading.send)?.gain.events.at(-1)).toMatchObject({
      type: "target",
      value: 0,
    });
  });

  test("a new device on the same node moves its gain onto a new graph", async () => {
    const h = createHarness();
    h.sinks.sync(devicesOf([["desk", "usb"]]));
    const { send } = h.connect("desk");
    await h.settle();

    h.sinks.sync(devicesOf([["desk", "hdmi"]]));
    await h.settle();

    expect(h.whereIs(send)).toBe("device:hdmi");
    expect(h.elements.map((element) => element.sinkId)).toEqual([
      "usb",
      "hdmi",
    ]);
    expect(h.elements[0]?.srcObject).toBeNull();
  });
});
