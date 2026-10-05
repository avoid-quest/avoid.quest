/**
 * Node Device Sinks
 *
 * One sink per Output device node, modelled on the CUE sink
 * (browser-output-adapter.ts): lane sends into one GainNode, then a
 * MediaStream hop into an `<audio>` element set to the device:
 *
 *   sends → input → MediaStreamDestination → <audio>.setSinkId(deviceId)
 *
 * The graph is built the first time a send connects, inside a play, so the
 * element's play() follows a user gesture. A sink that can't play says why
 * in its status, and its sends go to Speakers instead (`onReroute`):
 * `setSinkId` missing (Safari), rejected, or the device unplugged. When the
 * device comes back the sink is tried again.
 *
 * Output devices are not sample-aligned with Speakers, and the main output
 * delay does not apply to them.
 */

import {
  isMediaElementSinkIdSupported,
  safeDisconnect,
  safeDisconnectFrom,
} from "../utils";

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

/** Where a send into a sink goes. */
export type DeviceSinkRoute =
  | { to: "device"; release: () => void }
  | { to: "speakers" }
  | { to: "nowhere" };

export type NodeDeviceSinksOptions = {
  isSupported?: () => boolean;
  createElement?: () => HTMLAudioElement;
  /** The audiooutput device ids the browser lists now. */
  listOutputDeviceIds?: () => Promise<string[]>;
  /** Calls `onChange` on hot-plug; returns the unsubscribe. */
  watchDevices?: (onChange: () => void) => () => void;
  /** Changes when playback activates or starts deactivating. */
  getPlaybackEpoch?: () => number;
  /** A sink's sends must be routed again, e.g. it failed over to Speakers. */
  onReroute?: (sinkId: string) => void;
  /** Any sink's status changed. */
  onStatus?: () => void;
};

export type NodeDeviceSinks = {
  /** Matches the plan's Output devices: sink id → device id. */
  sync: (sinks: ReadonlyMap<string, string | null>) => void;
  /** Routes one lane send into `sinkId`. */
  connect: (sinkId: string, send: AudioNode) => DeviceSinkRoute;
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

type SinkEntry = {
  deviceId: string | null;
  status: DeviceSinkStatus;
  graph: SinkGraph | null;
  /** Bumped when the graph is torn down, so a late setSinkId is ignored. */
  generation: number;
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

function teardown(entry: SinkEntry): void {
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

export function createNodeDeviceSinks({
  isSupported = isMediaElementSinkIdSupported,
  createElement = () => new Audio(),
  listOutputDeviceIds: listIds = listOutputDeviceIds,
  watchDevices: watch = watchDevices,
  getPlaybackEpoch = () => 0,
  onReroute,
  onStatus,
}: NodeDeviceSinksOptions = {}): NodeDeviceSinks {
  const entries = new Map<string, SinkEntry>();
  /** The last device list with real ids; null until one is read. */
  let knownIds: Set<string> | null = null;
  let unwatch: (() => void) | null = null;

  const isPresent = (deviceId: string) =>
    deviceId === DEFAULT_DEVICE_ID || !knownIds || knownIds.has(deviceId);

  const restingStatus = (deviceId: string | null): DeviceSinkStatus => {
    if (!isSupported()) {
      return { state: "unsupported" };
    }
    if (deviceId === null) {
      return { state: "empty" };
    }
    return isPresent(deviceId) ? { state: "ok" } : { state: "unplugged" };
  };

  /** Sets a sink's status; its sends reroute when where they go changed. */
  const setStatus = (
    sinkId: string,
    entry: SinkEntry,
    next: DeviceSinkStatus
  ) => {
    const routedBefore = entry.status.state;
    entry.status = next;
    onStatus?.();
    if (routedBefore !== next.state) {
      onReroute?.(sinkId);
    }
  };

  const build = (
    sinkId: string,
    entry: SinkEntry,
    deviceId: string,
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
    const playbackEpoch = getPlaybackEpoch();
    const current = () =>
      entries.get(sinkId) === entry &&
      entry.generation === generation &&
      getPlaybackEpoch() === playbackEpoch;
    element
      .setSinkId(deviceId)
      .then(() => (current() ? element.play() : undefined))
      .catch((error: unknown) => {
        if (!current()) {
          return;
        }
        teardown(entry);
        setStatus(sinkId, entry, {
          message: errorMessage(error),
          state: "failed",
        });
      });
    return graph;
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
    for (const [sinkId, entry] of entries) {
      const { deviceId, status } = entry;
      if (deviceId === null || status.state === "unsupported") {
        continue;
      }
      if (!isPresent(deviceId) && status.state !== "unplugged") {
        teardown(entry);
        setStatus(sinkId, entry, { state: "unplugged" });
      } else if (isPresent(deviceId) && status.state === "unplugged") {
        setStatus(sinkId, entry, { state: "ok" });
      }
    }
  };

  const ensureWatching = () => {
    if (entries.size > 0 && !unwatch) {
      unwatch = watch(() => {
        checkDevices().catch(() => undefined);
      });
      checkDevices().catch(() => undefined);
    } else if (entries.size === 0 && unwatch) {
      unwatch();
      unwatch = null;
    }
  };

  return {
    checkDevices,
    connect(sinkId, send) {
      const entry = entries.get(sinkId);
      if (!entry || entry.deviceId === null) {
        return { to: "nowhere" };
      }
      if (entry.status.state !== "ok") {
        return { to: "speakers" };
      }
      // A graph from an AudioContext since replaced can't take this send.
      if (entry.graph && entry.graph.input.context !== send.context) {
        teardown(entry);
      }
      const graph =
        entry.graph ?? build(sinkId, entry, entry.deviceId, send.context);
      send.connect(graph.input);
      return {
        release: () => {
          safeDisconnectFrom(send, graph.input, "NodeDeviceSinks.release");
        },
        to: "device",
      };
    },
    dispose() {
      for (const entry of entries.values()) {
        teardown(entry);
      }
      entries.clear();
      ensureWatching();
    },
    retry(sinkId) {
      const entry = entries.get(sinkId);
      if (entry?.status.state === "failed") {
        setStatus(sinkId, entry, restingStatus(entry.deviceId));
      }
    },
    status: (sinkId) => entries.get(sinkId)?.status,
    statuses: () =>
      Object.fromEntries(
        [...entries].map(([sinkId, entry]) => [sinkId, entry.status])
      ),
    sync(sinks) {
      let changed = false;
      for (const [sinkId, entry] of entries) {
        if (!sinks.has(sinkId)) {
          teardown(entry);
          entries.delete(sinkId);
          changed = true;
        }
      }
      for (const [sinkId, deviceId] of sinks) {
        const entry = entries.get(sinkId);
        if (entry?.deviceId === deviceId) {
          continue;
        }
        changed = true;
        if (entry) {
          // A new device: its sends are routed again, onto a new graph.
          teardown(entry);
          entry.deviceId = deviceId;
          entry.status = restingStatus(deviceId);
          onReroute?.(sinkId);
        } else {
          entries.set(sinkId, {
            deviceId,
            generation: 0,
            graph: null,
            status: restingStatus(deviceId),
          });
        }
      }
      if (changed) {
        ensureWatching();
        onStatus?.();
      }
    },
  };
}
