import { dbToGain } from "@opendaw/lib-dsp";
import { ValueMapping } from "@opendaw/lib-std";
import { Store } from "@tanstack/react-store";
import type { ModulationHost } from "@/lib/audio/manager/official-modulation-target";
import {
  getAudioContext,
  resumeAudioContext,
} from "@/lib/audio/playback/audio-context";
import { subscribeModulationMidi } from "@/lib/midi/modulation-input";
import type { NodeEngine } from "@/lib/node-engine/engine";
import {
  type EngineParamTarget,
  paramKey,
} from "@/lib/node-engine/param-target";
import type { EnginePlan } from "./compile";
import type { ModulationMessage, ModulationProgram } from "./modulation-dsp";
import {
  createNativeModulationSession,
  isNativeModulation,
  type NativeDestination,
  type NativeModulationSession,
  type NativeModulationSpec,
} from "./modulation-native";
import {
  controlDepth,
  type ModulationParameter,
  modulatedValue,
  modulationParameters,
} from "./modulation-parameters";
import { MODULATION_DATA_SCHEMAS } from "./modulation-schema";
import { bindParam, mapParamValue, type ParamBinding } from "./param-binding";
import {
  type GraphEdge,
  type GraphNode,
  isModulationNode,
  type NodeGraph,
} from "./schema";

const idle = () => ({
  backends: {} as Record<string, "openDAW" | "DSP" | "unavailable">,
  error: null as string | null,
  nativeWarning: null as string | null,
  status: "idle" as "idle" | "starting" | "running" | "suspended" | "error",
  values: {} as Record<string, number>,
});
export const modulationReadouts = new Store(idle());
/** Why a cable's target isn't moved; `partly` while others it binds are. */
export type Unapplied = { why: string; partly: boolean };
/**
 * Modulation cables that would move something but aren't wholly applied, by
 * cable id, from the same check delivery makes: the canvas and each cable's
 * controls say it.
 */
export const unappliedModulation = new Store<
  Readonly<Record<string, Unapplied>>
>({});
const UNRESOLVED = "This parameter can't be modulated here";
const commands = new Set<(message: ModulationMessage) => void>();
export function runModulation(): void {
  resumeAudioContext().catch((error: unknown) =>
    modulationReadouts.setState((state) => ({
      ...state,
      error: String(error),
      status: "error",
    }))
  );
  for (const send of commands) {
    send({ type: "run" });
  }
}
export function gateModulator(id: string, on: boolean): void {
  if (on) {
    runModulation();
  }
  for (const send of commands) {
    send({ id, on, type: "gate" });
  }
}

const modules = new WeakMap<AudioContext, Promise<void>>();
type Packet = {
  type: "values";
  values: Record<string, number>;
  amounts?: Record<string, number>;
  resets?: string[];
};
type Options = {
  engine: Pick<
    NodeEngine,
    | "setParam"
    | "clearTransient"
    | "paramUnavailable"
    | "paramSoundId"
    | "tap"
    | "onParamsChanged"
    | "onTapsChanged"
  >;
  getWorkletProcessorUrl: () => string;
  getNativeHost: () => Promise<ModulationHost | null>;
};

/** One serial startup owns one worklet, native session and all input subscriptions. */
export function createModulationRuntime(options: Options) {
  const { engine, getWorkletProcessorUrl, getNativeHost } = options;
  let logical: ReturnType<typeof logicalParameters> = {
    parameters: [],
    unresolved: new Map(),
  };
  let parameters = new Map<string, PhysicalParameter>();
  let nativeDestinations: NativeDestination[] = [];
  const overlays = new Map<
    string,
    { target: EngineParamTarget; value: number }
  >();
  const clear = (key: string) => {
    const entry = overlays.get(key);
    if (entry) {
      try {
        engine.clearTransient(entry.target);
      } catch (error) {
        console.warn(
          "[NodePlayback] Could not clear modulation target",
          key,
          error
        );
      } finally {
        overlays.delete(key);
      }
    }
  };
  const refreshParameters = () => {
    nativeDestinations = [];
    const reasons = new Map<string, string>();
    for (const [key, physical] of parameters) {
      const { target } = physical.binding;
      const reason = engine.paramUnavailable(target);
      if (reason) {
        reasons.set(key, reason);
        clear(key);
      }
      const soundId = !reason && engine.paramSoundId(target);
      if (soundId) {
        nativeDestinations.push(...destinations(physical, soundId));
      }
    }
    const unapplied: Record<string, Unapplied> = Object.fromEntries(
      [...logical.unresolved].map(([id, why]) => [id, { partly: false, why }])
    );
    for (const { bindings, cables } of logical.parameters) {
      const missed = bindings.flatMap(
        (binding) => reasons.get(paramKey(binding.target)) ?? []
      );
      const [why] = missed;
      for (const cable of cables) {
        if (why) {
          unapplied[cable.id] ??= {
            partly: missed.length < bindings.length,
            why,
          };
        }
      }
    }
    if (
      JSON.stringify(unapplied) !== JSON.stringify(unappliedModulation.state)
    ) {
      unappliedModulation.setState(() => unapplied);
    }
  };
  const writeOverlay = (
    key: string,
    physical: PhysicalParameter,
    values: Readonly<Record<string, number>>
  ) => {
    const { target } = physical.binding;
    const value =
      engine.paramUnavailable(target) === null
        ? effectiveValue(physical, values)
        : undefined;
    if (value === undefined) {
      return overlays.has(key) ? () => clear(key) : undefined;
    }
    if (!Number.isFinite(value) || overlays.get(key)?.value === value) {
      return;
    }
    return () => {
      try {
        if (engine.setParam(target, value) === "applied") {
          overlays.set(key, { target, value });
        }
      } catch (error) {
        console.warn("[NodePlayback] Could not modulate target", key, error);
      }
    };
  };
  const parameterWrites = (
    values: Readonly<Record<string, number>>,
    coupled: boolean
  ) => {
    const writes: (() => void)[] = [];
    for (const [key, physical] of parameters) {
      if (
        physical.coupled === coupled &&
        (coupled || !("effectId" in physical.binding.target))
      ) {
        const write = writeOverlay(key, physical, values);
        if (write) {
          writes.push(write);
        }
      }
    }
    return writes;
  };
  let host: ModulationHost | null = null;
  let program: ModulationProgram = { followers: [], links: [], nodes: [] };
  let node: AudioWorkletNode | null = null;
  let silent: GainNode | null = null;
  let context: AudioContext | null = null;
  let pending: Promise<void> | null = null;
  let native: NativeModulationSession | null = null;
  let disposed = false;
  let taps: { source: AudioNode; input: number }[] = [];
  let nativeValues: Record<string, number> = {};
  let bridgeIds = new Set<string>();
  let specs: NativeModulationSpec[] = [];
  let nativeIds = new Set<string>();
  let enabledIds = new Set<string>();
  const queuedGates = new Map<string, { on: boolean; triggered: boolean }>();
  const queuedMidi = new Map<
    string,
    Extract<ModulationMessage, { type: "midi" }>
  >();
  const report = (error: unknown, nativeOnly = false) => {
    modulationReadouts.setState((state) =>
      nativeOnly
        ? {
            ...state,
            nativeWarning: `Native modulation unavailable: ${String(error)}`,
          }
        : { ...state, error: String(error), status: "error" }
    );
  };
  const safely = (release: () => void) => {
    try {
      release();
    } catch (error) {
      report(error);
    }
  };
  const stateChanged = () =>
    modulationReadouts.setState((state) => ({
      ...state,
      status: context?.state === "running" ? "running" : "suspended",
    }));
  const clearTaps = () => {
    for (const tap of taps) {
      safely(() => {
        if (node) {
          tap.source.disconnect(node, 0, tap.input);
        }
      });
    }
    taps = [];
  };
  const refreshTaps = () => {
    if (!node) {
      return;
    }
    const next = program.followers.flatMap((id, input) => {
      const source = engine.tap(id);
      return source ? [{ input, source }] : [];
    });
    if (
      next.length === taps.length &&
      next.every(
        (tap, index) =>
          tap.source === taps[index]?.source && tap.input === taps[index]?.input
      )
    ) {
      return;
    }
    clearTaps();
    for (const tap of next) {
      try {
        tap.source.connect(node, 0, tap.input);
        taps.push(tap);
      } catch (error) {
        report(error);
      }
    }
  };
  const releaseNative = () => {
    const previous = native;
    native = null;
    nativeValues = {};
    safely(() => previous?.dispose());
  };
  const releaseWorklet = () => {
    clearTaps();
    context?.removeEventListener("statechange", stateChanged);
    if (node) {
      const previous = node;
      node = null;
      safely(() =>
        previous.port.postMessage({ type: "stop" } satisfies ModulationMessage)
      );
      previous.port.onmessage = null;
      previous.onprocessorerror = null;
      safely(() => previous.disconnect());
      safely(() => previous.port.close());
    }
    safely(() => silent?.disconnect());
    silent = null;
  };
  const resolveSources = () => {
    nativeIds = new Set(
      program.nodes.filter(isNativeModulation).map((spec) => spec.id)
    );
    nativeValues = Object.fromEntries(
      Object.entries(nativeValues).filter(([id]) => nativeIds.has(id))
    );
    enabledIds = new Set(
      program.nodes.filter((spec) => spec.data.enabled).map((spec) => spec.id)
    );
    bridgeIds = new Set(
      nativeDestinations
        .filter(
          (destination) =>
            destination.native !== false && !nativeIds.has(destination.source)
        )
        .map((destination) => destination.source)
    );
    specs = program.nodes
      .filter((spec) => isNativeModulation(spec) || bridgeIds.has(spec.id))
      .map(
        (spec): NativeModulationSpec =>
          isNativeModulation(spec)
            ? spec
            : {
                data: MODULATION_DATA_SCHEMAS.macro.parse({
                  amount: 1,
                  bipolar: true,
                  enabled: spec.data.enabled,
                  value: ValueMapping.bipolar().x(
                    modulationReadouts.state.values[spec.id] ?? 0
                  ),
                }),
                id: spec.id,
                type: "macro",
              }
      );
  };
  const configure = () => {
    resolveSources();
    if (specs.length === 0) {
      releaseNative();
    } else if (host) {
      native ??= createNativeModulationSession(host, (id, value) => {
        if (nativeIds.has(id)) {
          nativeValues[id] = value;
        }
      });
    }
    native?.sync(specs, nativeDestinations);
    post({ program, type: "configure" });
    const nativeBackend = native ? "openDAW" : "unavailable";
    modulationReadouts.setState((state) => ({
      ...state,
      backends: Object.fromEntries(
        program.nodes.map((spec) => [
          spec.id,
          isNativeModulation(spec) ? nativeBackend : "DSP",
        ])
      ),
    }));
  };
  const deliver = (
    values: Readonly<Record<string, number>>,
    amounts: Readonly<Record<string, number>> = {}
  ) => {
    for (const write of parameterWrites(values, false)) {
      write();
    }
    const writes = parameterWrites(values, true);
    if (native !== null) {
      native.frame(
        Object.fromEntries(
          Object.entries(values).filter(([id]) => bridgeIds.has(id))
        ),
        amounts,
        writes
      );
    } else if (writes.length) {
      const write = () => {
        for (const apply of writes) {
          apply();
        }
      };
      if (host) {
        host.transaction(write);
      } else {
        write();
      }
    }
  };
  const frame = (packet: Packet) => {
    if (disposed || !node || packet.type !== "values") {
      return;
    }
    try {
      withNativeFallback(() => {
        native?.dispatch();
        for (const id of packet.resets ?? []) {
          native?.reset(id);
        }
        const values = Object.fromEntries(
          Object.entries({ ...packet.values, ...nativeValues }).filter(([id]) =>
            enabledIds.has(id)
          )
        );
        deliver(values, packet.amounts);
        post({ type: "native-values", values: nativeValues });
        modulationReadouts.setState((state) => ({ ...state, values }));
      });
    } finally {
      post({ type: "ack" });
    }
  };
  const post = (message: ModulationMessage) => node?.port.postMessage(message);
  const replay = () => {
    for (const [id, gate] of queuedGates) {
      if (gate.triggered) {
        post({ id, on: true, type: "gate" });
      }
      post({ id, on: gate.on, type: "gate" });
      if (gate.on) {
        queuedGates.set(id, { on: true, triggered: false });
      } else {
        queuedGates.delete(id);
      }
    }
    for (const [id, message] of queuedMidi) {
      post(message);
      const [status = 0, key = 0, velocity = 0] = message.bytes;
      const kind = Math.floor(status / 16);
      if (kind === 8 || (kind === 9 && velocity === 0)) {
        queuedMidi.delete(`note:${status % 16}:${key}:on`);
        queuedMidi.delete(id);
      }
    }
  };
  const needsHost = () =>
    specs.length > 0 ||
    nativeDestinations.some((destination) => destination.native === false);
  let hostRequest: Promise<void> | null = null;
  const withNativeFallback = (work: () => void) => {
    try {
      work();
    } catch (error) {
      releaseNative();
      host = null;
      safely(() => deliver({}));
      report(error, true);
      configure();
    }
  };
  const start = async () => {
    context = getAudioContext();
    const audio = context;
    modulationReadouts.setState((state) => ({
      ...state,
      error: null,
      nativeWarning: null,
      status: "starting",
    }));
    let loaded = modules.get(audio);
    if (!loaded) {
      loaded = audio.audioWorklet.addModule(getWorkletProcessorUrl());
      modules.set(audio, loaded);
      loaded.catch(() => modules.delete(audio));
    }
    await loaded;
    if (disposed || program.nodes.length === 0) {
      return;
    }
    try {
      if (needsHost()) {
        hostRequest ??= getNativeHost().then((resolved) => {
          host = resolved;
        });
        await hostRequest;
      }
    } catch (error) {
      report(error, true);
    }
    if (disposed || program.nodes.length === 0) {
      releaseNative();
      return;
    }
    const created = !node;
    if (!node) {
      node = new AudioWorkletNode(audio, "node-modulation-processor", {
        numberOfInputs: Math.max(1, program.followers.length),
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      silent = audio.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(audio.destination);
      node.onprocessorerror = () => {
        safely(() => deliver({}));
        releaseNative();
        releaseWorklet();
        report(new Error("Modulation worklet stopped"));
      };
      node.port.onmessage = ({ data }: MessageEvent<Packet>) => frame(data);
      audio.addEventListener("statechange", stateChanged);
    }
    withNativeFallback(configure);
    if (created) {
      replay();
    }
    refreshTaps();
    stateChanged();
  };
  const initialize = () => {
    if (
      disposed ||
      pending ||
      program.nodes.length === 0 ||
      (node && (!needsHost() || hostRequest))
    ) {
      return;
    }
    pending = start()
      .catch((error: unknown) => {
        releaseNative();
        if (!node) {
          releaseWorklet();
        }
        if (!disposed) {
          report(error, Boolean(node));
        }
      })
      .finally(() => {
        pending = null;
      });
  };
  const clearQueuedNotes = (channel: number) => {
    for (const id of queuedMidi.keys()) {
      if (id.startsWith(`note:${channel}:`)) {
        queuedMidi.delete(id);
      }
    }
  };
  // Retain held notes and the last CC even after delivery, so a replacement
  // worklet can recover them. While loading, also retain short press/release
  // pairs until replay; already-delivered releases must never retrigger.
  const queueMidi = (message: Extract<ModulationMessage, { type: "midi" }>) => {
    const [status = 0, key = 0, velocity = 0] = message.bytes;
    if (status === 255) {
      queuedMidi.clear();
      queuedMidi.set("reset", message);
      return;
    }
    const channel = status % 16;
    const kind = Math.floor(status / 16);
    if (![8, 9, 11].includes(kind) || key < 0 || key > 127) {
      return;
    }
    if (kind === 11 && (key === 120 || key === 123)) {
      clearQueuedNotes(channel);
    }
    const pressed = kind === 9 && velocity > 0;
    const id =
      kind === 11
        ? `cc:${channel}:${key}`
        : `note:${channel}:${key}:${pressed ? "on" : "off"}`;
    if (!pressed && kind !== 11 && node) {
      queuedMidi.delete(`note:${channel}:${key}:on`);
      queuedMidi.delete(id);
      return;
    }
    if (pressed) {
      queuedMidi.delete(`note:${channel}:${key}:off`);
    }
    // Reinsert so the last pressed note remains last after replay.
    queuedMidi.delete(id);
    queuedMidi.set(id, message);
  };
  const retryNative = () => {
    if (host === null && !pending && needsHost()) {
      hostRequest = null;
    }
  };
  const send = (message: ModulationMessage) => {
    if (message.type === "run") {
      retryNative();
      initialize();
      return;
    }
    if (
      message.type === "gate" &&
      !program.nodes.some((spec) => spec.id === message.id)
    ) {
      return;
    }
    if (message.type === "gate") {
      queuedGates.set(message.id, {
        on: message.on,
        triggered:
          !node &&
          (message.on || (queuedGates.get(message.id)?.triggered ?? false)),
      });
    }
    if (message.type === "midi" && program.nodes.length > 0) {
      queueMidi(message);
    }
    post(message);
    initialize();
  };
  commands.add(send);
  const stopMidi = subscribeModulationMidi((bytes) =>
    send({ bytes: Array.from(bytes), type: "midi" })
  );
  const refresh = () => {
    refreshParameters();
    refreshTaps();
    if (node && !disposed) {
      withNativeFallback(() => {
        configure();
        deliver(modulationReadouts.state.values);
      });
      initialize();
    }
  };
  const stopTargets = engine.onParamsChanged(refresh);
  const stopTaps = engine.onTapsChanged(refreshTaps);
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      commands.delete(send);
      stopTargets();
      stopTaps();
      stopMidi();
      queuedGates.clear();
      queuedMidi.clear();
      safely(() => deliver({}));
      releaseNative();
      for (const key of overlays.keys()) {
        clear(key);
      }
      parameters.clear();
      logical = { parameters: [], unresolved: new Map() };
      nativeDestinations = [];
      unappliedModulation.setState(() => ({}));
      releaseWorklet();
      modulationReadouts.setState(idle);
    },
    refresh,
    sync(graph: NodeGraph, plan: EnginePlan) {
      logical = logicalParameters(graph, plan);
      const resolved = resolveParameters(logical.parameters);
      for (const key of overlays.keys()) {
        if (!resolved.has(key)) {
          clear(key);
        }
      }
      parameters = resolved;
      refreshParameters();
      ({ program } = plan.modulation);
      resolveSources();
      const retained = new Set(program.nodes.map((spec) => spec.id));
      for (const id of queuedGates.keys()) {
        if (!retained.has(id)) {
          queuedGates.delete(id);
        }
      }
      if (program.nodes.length === 0) {
        deliver({});
        releaseNative();
        releaseWorklet();
        queuedMidi.clear();
        modulationReadouts.setState(idle);
        return;
      }
      if (node && node.numberOfInputs < program.followers.length) {
        releaseWorklet();
      }
      if (node) {
        withNativeFallback(() => {
          configure();
          refreshTaps();
        });
      }
      withNativeFallback(() =>
        deliver(
          Object.fromEntries(
            Object.entries(modulationReadouts.state.values).filter(([id]) =>
              enabledIds.has(id)
            )
          )
        )
      );
      send({ type: "run" });
    },
    async whenSettled() {
      await pending;
    },
  };
}

type Cable = { id: string; source: string; depth: number };
type LogicalParameter = {
  range: ModulationParameter;
  bindings: ParamBinding[];
  cables: Cable[];
};
type Contribution = Omit<LogicalParameter, "bindings"> & {
  binding: ParamBinding;
};
type PhysicalParameter = {
  binding: ParamBinding;
  coupled: boolean;
  contributions: Contribution[];
};
/**
 * The parameter a live cable moves; null when it moves nothing anyway (off,
 * at zero depth or from a switched-off modulator), undefined when its target
 * has no such parameter.
 */
function acceptedRange(
  cable: GraphEdge,
  nodes: ReadonlyMap<string, GraphNode>
) {
  const source = nodes.get(cable.source);
  const target = nodes.get(cable.target);
  if (
    !(isModulationNode(source) && source.data.enabled && target) ||
    cable.muted ||
    cable.depth === 0
  ) {
    return null;
  }
  const ranges = modulationParameters(target);
  return ranges.find(
    (entry) => entry.key === (cable.parameter ?? ranges[0]?.key)
  );
}
/**
 * Each parameter live cables move, and why each live cable that binds none
 * doesn't: the issue that refused its cable or target, if any.
 */
function logicalParameters(graph: NodeGraph, plan: EnginePlan) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parameters = new Map<string, LogicalParameter>();
  const unresolved = new Map<string, string>();
  const refuse = (cable: GraphEdge) =>
    unresolved.set(
      cable.id,
      plan.issues.find(
        ({ id, target }) =>
          (target === "edge" && id === cable.id) ||
          (target === "node" && id === cable.target)
      )?.message ?? UNRESOLVED
    );
  const planned = new Set(plan.modulation.cables.map((cable) => cable.id));
  for (const cable of graph.edges) {
    if (
      cable.targetHandle === "in:control:parameter" &&
      !planned.has(cable.id) &&
      acceptedRange(cable, nodes) !== null
    ) {
      refuse(cable);
    }
  }
  for (const cable of plan.modulation.cables) {
    const range = acceptedRange(cable, nodes);
    if (!range) {
      if (range === undefined) {
        refuse(cable);
      }
      continue;
    }
    const key = `${cable.target}:${range.key}`;
    let parameter = parameters.get(key);
    if (!parameter) {
      const bindings = bindParam(graph, cable.target, range.key, plan);
      if (bindings.length === 0) {
        unresolved.set(cable.id, UNRESOLVED);
        continue;
      }
      parameter = { bindings, cables: [], range };
      parameters.set(key, parameter);
    }
    parameter.cables.push({
      depth: controlDepth(cable),
      id: cable.id,
      source: cable.source,
    });
  }
  return { parameters: [...parameters.values()], unresolved };
}
function resolveParameters(moved: readonly LogicalParameter[]) {
  const parameters = new Map<string, PhysicalParameter>();
  for (const logical of moved) {
    for (const binding of logical.bindings) {
      const key = paramKey(binding.target);
      let physical = parameters.get(key);
      if (!physical) {
        physical = {
          binding,
          contributions: [],
          coupled: binding.coupled,
        };
        parameters.set(key, physical);
      }
      physical.contributions.push({
        binding,
        cables: logical.cables,
        range: logical.range,
      });
    }
  }
  return parameters;
}
function offsetOf(
  cables: readonly Cable[],
  values: Readonly<Record<string, number>>
) {
  return cables.reduce((sum, cable) => {
    const value = values[cable.source];
    return (
      sum +
      (value !== undefined && Number.isFinite(value) ? value * cable.depth : 0)
    );
  }, 0);
}
/** Folded decibel/linear gains multiply; strip pans add before the physical clamp. */
function effectiveValue(
  physical: PhysicalParameter,
  values: Readonly<Record<string, number>>
) {
  const updates = physical.contributions.map((entry) => ({
    ...entry,
    offset: offsetOf(entry.cables, values),
  }));
  if (updates.every((entry) => entry.offset === 0)) {
    return;
  }
  const { binding } = physical;
  if (binding.kind === "pan") {
    return updates.reduce(
      (sum, entry) =>
        sum +
        modulatedValue(entry.binding.authored, entry.offset, entry.range) -
        entry.binding.authored,
      binding.base
    );
  }
  let value =
    binding.target.kind === "send"
      ? (binding.factor ?? binding.base)
      : mapParamValue(binding, binding.authored);
  let ratio = 1;
  for (const entry of updates) {
    const own = entry.binding;
    const next = modulatedValue(own.authored, entry.offset, entry.range);
    if (own.kind === "gain") {
      ratio *= dbToGain(next - own.authored);
    } else if (own.kind === "wet" || own.kind === "dry") {
      ratio *=
        own.kind === "dry"
          ? (1 - next) / (1 - own.authored || 1)
          : next / (own.authored || 1);
    } else if (
      own.kind === "value" &&
      own.authored !== 0 &&
      (updates.length > 1 || own.base !== own.authored)
    ) {
      ratio *= next / own.authored;
    } else {
      value = mapParamValue(own, next);
    }
  }
  return value * ratio;
}
function destinations(
  physical: PhysicalParameter,
  soundId: string
): NativeDestination[] {
  const { target } = physical.binding;
  if (target.kind !== "effect" && target.kind !== "chain") {
    return [];
  }
  return physical.contributions.flatMap((entry) =>
    entry.cables.map((cable) => ({
      depth: cable.depth,
      enabled: true,
      id: `${cable.id}:${paramKey(target)}`,
      native: !physical.coupled,
      soundId,
      source: cable.source,
      target,
    }))
  );
}
