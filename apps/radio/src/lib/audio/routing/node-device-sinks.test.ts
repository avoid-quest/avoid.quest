import { describe, expect, mock, test } from "bun:test";
import { FakeAudioContext, type FakeGainNode } from "./fake-audio-nodes";
import { createNodeDeviceSinks } from "./node-device-sinks";

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
}: {
  supported?: boolean;
  ids?: string[];
} = {}) {
  const elements: FakeAudioElement[] = [];
  const context = new FakeAudioContext();
  const devices = { ids };
  let hotPlug: (() => void) | null = null;
  const onReroute = mock((_sinkId: string) => undefined);
  const onStatus = mock(() => undefined);
  const sinks = createNodeDeviceSinks({
    createElement: () => {
      const element = new FakeAudioElement();
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
    isSupported: () => supported,
    listOutputDeviceIds: async () => devices.ids,
    onReroute,
    onStatus,
    watchDevices: (onChange) => {
      hotPlug = onChange;
      return () => {
        hotPlug = null;
      };
    },
  });
  const send = () => context.createGain() as unknown as AudioNode;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    context,
    devices,
    elements,
    hotPlug: () => hotPlug?.(),
    onReroute,
    onStatus,
    send,
    settle,
    sinks,
  };
}

describe("createNodeDeviceSinks", () => {
  test("a send plays through a MediaStream hop into an <audio> set to the device", async () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", "usb"]]));
    const send = harness.send();

    const route = harness.sinks.connect("desk", send);
    await harness.settle();

    expect(route.to).toBe("device");
    const [input] = harness.context.gains.slice(-1) as FakeGainNode[];
    const [destination] = harness.context.destinations;
    const [element] = harness.elements;
    expect((send as unknown as FakeGainNode).connections.has(input)).toBe(true);
    expect(input?.connections.has(destination)).toBe(true);
    expect(element?.srcObject).toBe(destination?.stream);
    expect(element?.setSinkId).toHaveBeenCalledWith("usb");
    expect(element?.paused).toBe(false);
    expect(harness.sinks.status("desk")).toEqual({ state: "ok" });
  });

  test("every send into one sink shares its graph", () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", "usb"]]));

    harness.sinks.connect("desk", harness.send());
    harness.sinks.connect("desk", harness.send());

    expect(harness.elements).toHaveLength(1);
    expect(harness.context.destinations).toHaveLength(1);
  });

  test("a send from a new AudioContext gets a new graph on it", async () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", "usb"]]));
    harness.sinks.connect("desk", harness.send());
    await harness.settle();
    const [oldElement] = harness.elements;
    const [oldDestination] = harness.context.destinations;

    const fresh = new FakeAudioContext();
    const send = fresh.createGain() as unknown as FakeGainNode;
    const route = harness.sinks.connect("desk", send as unknown as AudioNode);
    await harness.settle();

    expect(route.to).toBe("device");
    expect(oldElement?.paused).toBe(true);
    expect(oldDestination?.stopped).toEqual([true]);
    const [input] = fresh.gains.slice(-1);
    const [destination] = fresh.destinations;
    expect(send.connections.has(input)).toBe(true);
    expect(input?.connections.has(destination)).toBe(true);
    expect(harness.elements[1]?.setSinkId).toHaveBeenCalledWith("usb");
  });

  test("an Output device with no device picked plays nowhere", () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", null]]));

    expect(harness.sinks.connect("desk", harness.send())).toEqual({
      to: "nowhere",
    });
    expect(harness.sinks.status("desk")).toEqual({ state: "empty" });
  });

  test("without setSinkId every sink plays through Speakers", () => {
    const harness = createHarness({ supported: false });
    harness.sinks.sync(new Map([["desk", "usb"]]));

    expect(harness.sinks.connect("desk", harness.send())).toEqual({
      to: "speakers",
    });
    expect(harness.sinks.status("desk")).toEqual({ state: "unsupported" });
    expect(harness.elements).toHaveLength(0);
  });

  test("a rejected setSinkId marks the sink failed and reroutes its sends", async () => {
    const harness = createHarness();
    const elements: FakeAudioElement[] = [];
    const sinks = createNodeDeviceSinks({
      createElement: () => {
        const element = new FakeAudioElement();
        element.rejectSink = new Error("Permission denied");
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
      isSupported: () => true,
      listOutputDeviceIds: async () => ["default", "usb"],
      onReroute: harness.onReroute,
      watchDevices: () => () => undefined,
    });
    sinks.sync(new Map([["desk", "usb"]]));

    expect(sinks.connect("desk", harness.send()).to).toBe("device");
    await harness.settle();

    expect(sinks.status("desk")).toEqual({
      message: "Permission denied",
      state: "failed",
    });
    expect(harness.onReroute).toHaveBeenCalledWith("desk");
    expect(elements[0]?.srcObject).toBeNull();
    expect(sinks.connect("desk", harness.send())).toEqual({ to: "speakers" });
  });

  test("an unplugged device fails over to Speakers and comes back when plugged in", async () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", "usb"]]));
    await harness.settle();
    harness.sinks.connect("desk", harness.send());
    await harness.settle();
    const [element] = harness.elements;

    harness.devices.ids = ["default", "hdmi"];
    harness.hotPlug();
    await harness.settle();

    expect(harness.sinks.status("desk")).toEqual({ state: "unplugged" });
    expect(harness.onReroute).toHaveBeenCalledWith("desk");
    expect(element?.pause).toHaveBeenCalled();
    expect(harness.sinks.connect("desk", harness.send())).toEqual({
      to: "speakers",
    });

    harness.devices.ids = ["default", "hdmi", "usb"];
    harness.hotPlug();
    await harness.settle();

    expect(harness.sinks.status("desk")).toEqual({ state: "ok" });
    expect(harness.sinks.connect("desk", harness.send()).to).toBe("device");
  });

  test.each(["remove", "replace", "dispose"] as const)(
    "a pending retry cannot play after %s invalidates its output",
    async (action) => {
      const harness = createHarness();
      const attempt = Promise.withResolvers<void>();
      const elements: FakeAudioElement[] = [];
      const sinks = createNodeDeviceSinks({
        createElement: () => {
          const element = new FakeAudioElement();
          if (elements.length === 0) {
            element.rejectSink = new Error("Permission denied");
          } else if (elements.length === 1) {
            element.setSinkId = mock(() => attempt.promise);
          }
          elements.push(element);
          return element as unknown as HTMLAudioElement;
        },
        isSupported: () => true,
        listOutputDeviceIds: async () => ["default", "usb", "hdmi"],
        watchDevices: () => () => undefined,
      });
      sinks.sync(new Map([["desk", "usb"]]));
      sinks.connect("desk", harness.send());
      await harness.settle();
      sinks.retry("desk");
      sinks.connect("desk", harness.send());

      if (action === "dispose") {
        sinks.dispose();
      } else {
        sinks.sync(new Map(action === "replace" ? [["desk", "hdmi"]] : []));
      }
      attempt.resolve();
      await harness.settle();

      expect(elements[1]?.play).not.toHaveBeenCalled();
      expect(elements[1]?.srcObject).toBeNull();
      expect(harness.context.destinations[1]?.stopped).toEqual([true]);
      expect(sinks.status("desk")).toEqual(
        action === "replace" ? { state: "ok" } : undefined
      );
      sinks.retry("desk");
      expect(elements).toHaveLength(2);
    }
  );

  test("a device list without ids (no permission yet) unplugs nothing", async () => {
    const harness = createHarness({ ids: ["", ""] });
    harness.sinks.sync(new Map([["desk", "usb"]]));
    await harness.settle();

    expect(harness.sinks.status("desk")).toEqual({ state: "ok" });
  });

  test("removing an Output device disposes its <audio> and MediaStreamDestination", async () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", "usb"]]));
    harness.sinks.connect("desk", harness.send());
    await harness.settle();
    const [element] = harness.elements;
    const [destination] = harness.context.destinations;
    const input = harness.context.gains.at(-1);

    harness.sinks.sync(new Map());

    expect(element?.pause).toHaveBeenCalled();
    expect(element?.srcObject).toBeNull();
    expect(destination?.stopped).toEqual([true]);
    expect(input?.connections.size).toBe(0);
    expect(harness.sinks.status("desk")).toBeUndefined();
  });

  test("a new device on the same node reroutes its sends onto a new graph", async () => {
    const harness = createHarness();
    harness.sinks.sync(new Map([["desk", "usb"]]));
    harness.sinks.connect("desk", harness.send());
    await harness.settle();

    harness.sinks.sync(new Map([["desk", "hdmi"]]));
    harness.sinks.connect("desk", harness.send());
    await harness.settle();

    expect(harness.onReroute).toHaveBeenCalledWith("desk");
    expect(harness.elements.map((element) => element.sinkId)).toEqual([
      "usb",
      "hdmi",
    ]);
    expect(harness.elements[0]?.srcObject).toBeNull();
  });
});
