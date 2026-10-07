/**
 * Node Device Sinks
 *
 * One GainNode per Output node, Speakers or an Output device, that every
 * cable into the node passes through. Its level is the node's own (0 while
 * muted), so a change reaches every cable into it at once, the ones still
 * fading out included. Speakers play on the main bus; an Output device's
 * gain goes into one graph per physical device, modelled on the CUE sink
 * (browser-output-adapter.ts):
 *
 *   cables → node gain → main bus                                (Speakers)
 *   cables → node gain → device input → MediaStreamDestination
 *                                     → <audio>.setSinkId(deviceId)
 *
 * Several nodes can play to one device, each through its own gain, so its
 * mute and removal leave the others playing. A node's gain stays while any
 * cable holds it, the plan's or not, so a removed node's cables fade out
 * through it; a device's graph goes once no node uses it. The
 * graph is built the first time a gain needs it, inside a play, so the
 * element's play() follows a user gesture. A device that can't play says
 * why in each of its nodes' status, and their gains go to the main bus
 * instead: `setSinkId` missing (Safari), rejected, or the device unplugged.
 * When the device comes back it is tried again.
 *
 * Realtime cables (live inputs) skip the main delay, so a node has one gain
 * per timing it is fed with. Output devices are not sample-aligned with
 * Speakers, and the main output delay does not apply to them.
 */

import {
  isMediaElementSinkIdSupported,
  safeDisconnect,
  safeDisconnectFrom,
} from "../utils";
import { settleGain } from "./sends";

export type DeviceSinkStatus =
  /** No device picked yet: its cables stay silent. */
  | { state: "empty" }
  /** Ready to play, or playing. */
  | { state: "ok" }
  /** The browser can't choose an output: its cables play through Speakers. */
  | { state: "unsupported" }
  /** The device went away: its cables play through Speakers till it's back. */
  | { state: "unplugged" }
  /** setSinkId or play() rejected: its cables play through Speakers. */
  | { state: "failed"; message: string };

/** An Output node as the plan has it. */
export type NodeOutputPlan = {
  /**
   * An Output device's device, or null while none is picked; Speakers
   * have none and play on the main bus.
   */
  deviceId?: string | null;
  muted: boolean;
};

export type NodeDeviceSinksOptions = {
  /** Puts a node's gain on the main bus; returns the disconnect. */
  connectMain: (node: AudioNode, realtime: boolean) => () => void;
  isSupported?: () => boolean;
  createElement?: () => HTMLAudioElement;
  /** The audiooutput device ids the browser lists now. */
  listOutputDeviceIds?: () => Promise<string[]>;
  /** Calls `onChange` on hot-plug; returns the unsubscribe. */
  watchDevices?: (onChange: () => void) => () => void;
  /** Whether playback still runs: false once it starts deactivating. */
  isActive?: () => boolean;
  /** Any sink's status changed. */
  onStatus?: () => void;
};

export type NodeDeviceSinks = {
  /**
   * Matches the plan's Output nodes, by node id, and sets the master
   * volume every node's gain plays at, a removed node's included.
   */
  sync: (outputs: ReadonlyMap<string, NodeOutputPlan>, master: number) => void;
  /**
   * Connects one cable's send into Output node `sinkId` and holds the node
   * until the returned release.
   */
  connect: (sinkId: string, send: AudioNode, realtime: boolean) => () => void;
  /** Tries a failed sink again from an explicit user action. */
  retry: (sinkId: string) => void;
  status: (sinkId: string) => DeviceSinkStatus | undefined;
  statuses: () => Record<string, DeviceSinkStatus>;
  /** Re-reads the device list now, as a hot-plug does. */
  checkDevices: () => Promise<void>;
  dispose: () => void;
};

type SinkGraph = {
  input: GainNode;
  destination: MediaStreamAudioDestinationNode;
  element: HTMLAudioElement;
};

/** One physical device: one graph, whatever number of nodes play to it. */
type DeviceEntry = {
  status: DeviceSinkStatus;
  graph: SinkGraph | null;
  /** Bumped when the graph is torn down, so a late setSinkId is ignored. */
  generation: number;
};

/** One Output node's gain for one timing. */
type NodeGain = {
  readonly sinkId: string;
  readonly realtime: boolean;
  readonly gain: GainNode;
  /** The node's plan: the latest, or the last one once it left the plan. */
  plan: NodeOutputPlan;
  /** Cables connected into it. */
  holds: number;
  /** Its connection onward. */
  release: () => void;
};

/** The main output's own id; a browser always has it while it has audio. */
const DEFAULT_DEVICE_ID = "default";

async function listOutputDeviceIds(): Promise<string[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audiooutput")
    .map((device) => device.deviceId);
}

function watchDevices(onChange: () => void): () => void {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return () => undefined;
  }
  navigator.mediaDevices.addEventListener("devicechange", onChange);
  return () => {
    navigator.mediaDevices.removeEventListener("devicechange", onChange);
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The browser refused this output";
}

function teardown(entry: DeviceEntry): void {
  const { graph } = entry;
  entry.generation += 1;
  entry.graph = null;
  if (!graph) {
    return;
  }
  safeDisconnectFrom(
    graph.input,
    graph.destination,
    "NodeDeviceSinks.teardown"
  );
  safeDisconnect(graph.input, "NodeDeviceSinks.teardown");
  graph.element.pause();
  graph.element.srcObject = null;
  for (const track of graph.destination.stream?.getTracks?.() ?? []) {
    track.stop();
  }
}

function gainKey(sinkId: string, realtime: boolean): string {
  return `${realtime ? "realtime" : "main"}:${sinkId}`;
}

export function createNodeDeviceSinks({
  connectMain,
  isSupported = isMediaElementSinkIdSupported,
  createElement = () => new Audio(),
  listOutputDeviceIds: listIds = listOutputDeviceIds,
  watchDevices: watch = watchDevices,
  isActive = () => true,
  onStatus,
}: NodeDeviceSinksOptions): NodeDeviceSinks {
  /** The plan's Output nodes. */
  let outputs: ReadonlyMap<string, NodeOutputPlan> = new Map();
  let master = 1;
  const gains = new Map<string, NodeGain>();
  const devices = new Map<string, DeviceEntry>();
  /** The last device list with real ids; null until one is read. */
  let knownIds: Set<string> | null = null;
  let unwatch: (() => void) | null = null;

  const levelOf = (plan: NodeOutputPlan) => (plan.muted ? 0 : master);

  const isPresent = (deviceId: string) =>
    deviceId === DEFAULT_DEVICE_ID || !knownIds || knownIds.has(deviceId);

  const restingStatus = (deviceId: string): DeviceSinkStatus => {
    if (!isSupported()) {
      return { state: "unsupported" };
    }
    return isPresent(deviceId) ? { state: "ok" } : { state: "unplugged" };
  };

  const statusOf = (sinkId: string): DeviceSinkStatus | undefined => {
    const deviceId = outputs.get(sinkId)?.deviceId;
    if (deviceId === undefined) {
      return;
    }
    return deviceId === null
      ? { state: "empty" }
      : (devices.get(deviceId)?.status ?? restingStatus(deviceId));
  };

  const build = (
    deviceId: string,
    entry: DeviceEntry,
    context: BaseAudioContext
  ): SinkGraph => {
    const audio = context as AudioContext;
    const input = audio.createGain();
    const destination = audio.createMediaStreamDestination();
    const element = createElement();
    input.connect(destination);
    element.srcObject = destination.stream;
    element.volume = 1;
    const graph = { destination, element, input };
    entry.graph = graph;
    const { generation } = entry;
    const current = () =>
      devices.get(deviceId) === entry &&
      entry.generation === generation &&
      isActive();
    element
      .setSinkId(deviceId)
      .then(() => (current() ? element.play() : undefined))
      .catch((error: unknown) => {
        if (!current()) {
          return;
        }
        teardown(entry);
        setStatus(deviceId, entry, {
          message: errorMessage(error),
          state: "failed",
        });
      });
    return graph;
  };

  /**
   * Connects a node's gain where its node plays now: its device, the main
   * bus while that device can't play, or nowhere with no device picked.
   */
  const place = (node: NodeGain) => {
    node.release();
    const { deviceId } = node.plan;
    if (deviceId === null) {
      node.release = () => undefined;
      return;
    }
    const entry = deviceId === undefined ? undefined : devices.get(deviceId);
    if (!(deviceId && entry?.status.state === "ok")) {
      node.release = connectMain(node.gain, node.realtime);
      return;
    }
    // A graph from an AudioContext since replaced can't take this gain.
    if (entry.graph && entry.graph.input.context !== node.gain.context) {
      teardown(entry);
    }
    const { input } = entry.graph ?? build(deviceId, entry, node.gain.context);
    node.gain.connect(input);
    node.release = () => {
      safeDisconnectFrom(node.gain, input, "NodeDeviceSinks.place");
    };
  };

  /** A device is kept while a node in the plan or a held gain uses it. */
  const syncDevices = () => {
    const used = new Set<string>();
    for (const plan of [
      ...outputs.values(),
      ...[...gains.values()].map((node) => node.plan),
    ]) {
      if (plan.deviceId) {
        used.add(plan.deviceId);
      }
    }
    for (const [deviceId, entry] of devices) {
      if (!used.has(deviceId)) {
        teardown(entry);
        devices.delete(deviceId);
      }
    }
    for (const deviceId of used) {
      if (!devices.has(deviceId)) {
        devices.set(deviceId, {
          generation: 0,
          graph: null,
          status: restingStatus(deviceId),
        });
      }
    }
    ensureWatching();
  };

  const drop = (node: NodeGain) => {
    gains.delete(gainKey(node.sinkId, node.realtime));
    node.release();
    safeDisconnect(node.gain, "NodeDeviceSinks.drop");
  };

  /** A gain goes once no cable holds it. */
  const collect = (node: NodeGain) => {
    if (
      node.holds === 0 &&
      gains.get(gainKey(node.sinkId, node.realtime)) === node
    ) {
      drop(node);
      syncDevices();
    }
  };

  /** Sets a device's status; its gains move when where they go changed. */
  const setStatus = (
    deviceId: string,
    entry: DeviceEntry,
    next: DeviceSinkStatus
  ) => {
    const before = entry.status.state;
    entry.status = next;
    onStatus?.();
    if (before !== next.state) {
      for (const node of gains.values()) {
        if (node.plan.deviceId === deviceId) {
          place(node);
        }
      }
    }
  };

  const checkDevices = async () => {
    let ids: string[];
    try {
      ids = await listIds();
    } catch {
      return;
    }
    // Without mic permission the list has no ids: nothing to judge by.
    const real = ids.filter(Boolean);
    knownIds = real.length > 0 ? new Set(real) : null;
    for (const [deviceId, entry] of devices) {
      const { status } = entry;
      if (status.state === "unsupported") {
        continue;
      }
      if (!isPresent(deviceId) && status.state !== "unplugged") {
        teardown(entry);
        setStatus(deviceId, entry, { state: "unplugged" });
      } else if (isPresent(deviceId) && status.state === "unplugged") {
        setStatus(deviceId, entry, { state: "ok" });
      }
    }
  };

  const ensureWatching = () => {
    if (devices.size > 0 && !unwatch) {
      unwatch = watch(() => {
        checkDevices().catch(() => undefined);
      });
      checkDevices().catch(() => undefined);
    } else if (devices.size === 0 && unwatch) {
      unwatch();
      unwatch = null;
    }
  };

  return {
    checkDevices,
    connect(sinkId, send, realtime) {
      const key = gainKey(sinkId, realtime);
      let node = gains.get(key);
      const plan = outputs.get(sinkId) ?? node?.plan;
      if (!plan) {
        return () => undefined;
      }
      // A gain from an AudioContext since replaced carries nothing.
      if (node && node.gain.context !== send.context) {
        drop(node);
        node = undefined;
      }
      if (!node) {
        const gain = send.context.createGain();
        gain.gain.value = levelOf(plan);
        node = {
          gain,
          holds: 0,
          plan,
          realtime,
          release: () => undefined,
          sinkId,
        };
        gains.set(key, node);
        syncDevices();
        place(node);
      }
      const held = node;
      send.connect(held.gain);
      held.holds += 1;
      return () => {
        safeDisconnectFrom(send, held.gain, "NodeDeviceSinks.release");
        held.holds -= 1;
        collect(held);
      };
    },
    dispose() {
      for (const node of [...gains.values()]) {
        drop(node);
      }
      for (const entry of devices.values()) {
        teardown(entry);
      }
      devices.clear();
      outputs = new Map();
      ensureWatching();
    },
    retry(sinkId) {
      const deviceId = outputs.get(sinkId)?.deviceId;
      const entry = deviceId ? devices.get(deviceId) : undefined;
      if (deviceId && entry?.status.state === "failed") {
        setStatus(deviceId, entry, restingStatus(deviceId));
      }
    },
    status: statusOf,
    statuses: () =>
      Object.fromEntries(
        [...outputs.keys()].flatMap((sinkId) => {
          const status = statusOf(sinkId);
          return status ? [[sinkId, status]] : [];
        })
      ),
    sync(next, level) {
      const changed =
        outputs.size !== next.size ||
        [...next].some(
          ([sinkId, plan]) =>
            !outputs.has(sinkId) ||
            outputs.get(sinkId)?.deviceId !== plan.deviceId
        );
      outputs = new Map(next);
      master = level;
      syncDevices();
      for (const node of gains.values()) {
        // A removed node's gain keeps its last plan, its mute included.
        const plan = outputs.get(node.sinkId) ?? node.plan;
        const moved = plan.deviceId !== node.plan.deviceId;
        node.plan = plan;
        settleGain(node.gain, levelOf(plan));
        if (moved) {
          place(node);
        }
      }
      syncDevices();
      if (changed) {
        onStatus?.();
      }
    },
  };
}
