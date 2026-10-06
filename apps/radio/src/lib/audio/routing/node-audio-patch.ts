import type { AudioPatchPlan } from "@/lib/node-graph/audio-patch-plan";
import { branchIndex } from "@/lib/node-graph/branches";
import { getNodeDefinition, portHandleId } from "@/lib/node-graph/catalogue";
import type { GraphEdge, GraphNode } from "@/lib/node-graph/schema";
import type { EffectChainConfig, EffectConfig } from "../dsp/effects/types";
import { isEffectContainer } from "../dsp/routing/effect-tree";
import type { AudioManager } from "../manager/audio-manager";
import { safeDisconnect, safeDisconnectFrom } from "../utils";

export type PatchHost = Pick<
  AudioManager,
  | "connectNodeProcessor"
  | "updateNodeProcessor"
  | "modulateNodeProcessor"
  | "getEffectsRuntimeOutcome"
  | "releaseNodeProcessor"
>;
type Route = (sinkId: string, send: GainNode) => () => void;
type Port = { out: AudioNode; processorId?: string; effects?: EffectConfig[] };
type Module = {
  host: PatchHost;
  keyRegistered: boolean;
  sinkRelease?: () => void;
  type: GraphNode["type"];
  input: GainNode;
  key: GainNode;
  keyId: string;
  ports: Map<string, Port>;
};
type Cable = {
  source: AudioNode;
  target: AudioNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
};
const MAIN = "out:audio:main";
const FADE_MS = 35;

function processorId(id: string, port: string): string {
  return `node-patch:${id.length}:${id}:${port}`;
}

/** One branch's signal, without copying any downstream processors. */
export function patchPortEffects(
  node: GraphNode,
  handle: string,
  keyed: boolean
): EffectConfig[] {
  if (!getNodeDefinition(node.type).effectType) {
    return [];
  }
  const { sidechain: _, ...authored } = (node.data as { effect: EffectConfig })
    .effect;
  let effect = { ...authored, id: node.id, order: 0 } as EffectConfig;
  if (isEffectContainer(effect)) {
    const index = branchIndex(handle) - 1;
    const chains = [...effect.chains].sort(
      (left, right) => left.order - right.order
    );
    if (effect.type === "fxComposite") {
      const selected: EffectChainConfig = chains[index] ?? {
        effects: [],
        gain: Math.SQRT1_2,
        id: `${node.id}:${handle}`,
        muted: false,
        name: "Branch",
        order: 0,
        pan: 0,
        solo: false,
      };
      effect = {
        ...effect,
        chains: [
          {
            ...selected,
            effects: [],
            muted:
              selected.muted ||
              (chains.some((chain) => chain.solo) && !selected.solo),
            order: 0,
          },
        ],
      };
    } else {
      effect = {
        ...effect,
        chains: chains.map((chain, order) => ({
          ...chain,
          effects: [],
          muted: chain.muted || order !== index,
        })),
      };
    }
  }
  return [
    keyed
      ? ({
          ...effect,
          ...(effect.type === "vocoder" ? { modulatorSource: "external" } : {}),
          sidechain: { channelId: "patch-key" },
        } as EffectConfig)
      : effect,
  ];
}

/** Stable modules, one smoothed gain per cable, and one processor per actual FX port. */
export function createNodeAudioPatch({
  getHost,
  route,
  onError,
  onChange,
  wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  getHost: () => PatchHost;
  route: Route;
  onError: (error: unknown) => void;
  onChange?: () => void;
  wait?: (ms: number) => Promise<void>;
}) {
  let plan: AudioPatchPlan | undefined;
  let context: BaseAudioContext | null = null;
  const modules = new Map<string, Module>();
  const cables = new Map<string, Cable>();
  const pending = new Set<Promise<unknown>>();
  let host: PatchHost | null = null;
  let revision = 0;

  const track = (promise: Promise<unknown>) => {
    pending.add(promise);
    promise.catch(onError).finally(() => {
      pending.delete(promise);
      onChange?.();
    });
  };
  const ramp = (param: AudioParam, value: number) => {
    param.setTargetAtTime(value, context?.currentTime ?? 0, 0.005);
  };
  const releaseModule = (module: Module) => {
    module.host.releaseNodeProcessor(module.keyId);
    module.sinkRelease?.();
    for (const port of module.ports.values()) {
      if (port.processorId) {
        module.host.releaseNodeProcessor(port.processorId);
      }
      safeDisconnect(port.out, "NodeAudioPatch.releasePort");
    }
    safeDisconnect(module.input, "NodeAudioPatch.releaseInput");
    safeDisconnect(module.key, "NodeAudioPatch.releaseKey");
  };
  const releaseCable = (cable: Cable) => {
    safeDisconnectFrom(cable.source, cable.gain, "NodeAudioPatch.releaseCable");
    safeDisconnect(cable.gain, "NodeAudioPatch.releaseCable");
    safeDisconnect(cable.pan, "NodeAudioPatch.releasePan");
  };
  const dropCable = (id: string, cable: Cable) => {
    cables.delete(id);
    ramp(cable.gain.gain, 0);
    track(wait(FADE_MS).then(() => releaseCable(cable)));
  };
  const createModule = (node: GraphNode): Module => {
    if (!(context && host)) {
      throw new Error("Audio patch has no context");
    }
    const input = context.createGain();
    const key = context.createGain();
    revision += 1;
    const keyId = processorId(node.id, `key:${revision}`);
    const module: Module = {
      host,
      input,
      key,
      keyId,
      keyRegistered: false,
      ports: new Map(),
      type: node.type,
    };
    for (const port of getNodeDefinition(node.type).ports.filter(
      (entry) => entry.direction === "out" && entry.kind === "audio"
    )) {
      let out: AudioNode;
      if (node.type === "filter") {
        out = context.createBiquadFilter();
      } else if (node.type === "pan") {
        out = context.createStereoPanner();
      } else {
        out = context.createGain();
      }
      const handle = portHandleId(port);
      if (!getNodeDefinition(node.type).effectType) {
        input.connect(out);
      }
      module.ports.set(handle, { out });
    }
    if (getNodeDefinition(node.type).category === "output") {
      module.sinkRelease = route(node.id, input);
    }
    return module;
  };
  const hasKey = (id: string) =>
    [...(plan?.edges.values() ?? [])].some(
      (edge) =>
        edge.target === id &&
        edge.targetHandle === "in:sidechain:key" &&
        !edge.muted &&
        edge.gain > 0
    );
  const syncKey = (module: Module, keyed: boolean) => {
    if (keyed && !module.keyRegistered && context) {
      module.keyRegistered = true;
      track(
        module.host.connectNodeProcessor(
          module.keyId,
          module.key,
          context.createGain(),
          [],
          null
        )
      );
    } else if (!keyed && module.keyRegistered) {
      module.keyRegistered = false;
      module.host.releaseNodeProcessor(module.keyId);
    }
  };
  const updateNative = (node: GraphNode, out: AudioNode) => {
    if (node.type === "filter") {
      const filter = out as BiquadFilterNode;
      filter.type = node.data.type;
      ramp(filter.frequency, node.data.frequency);
      ramp(filter.Q, node.data.Q);
    } else if (node.type === "pan") {
      ramp((out as StereoPannerNode).pan, node.data.pan);
    } else if (node.type === "gain") {
      ramp((out as GainNode).gain, 10 ** (node.data.gainDb / 20));
    }
  };
  const updatePort = (
    node: GraphNode,
    module: Module,
    handle: string,
    port: Port,
    transient: boolean
  ) => {
    const keyed = hasKey(node.id);
    const effects = patchPortEffects(node, handle, keyed);
    const key = keyed ? module.keyId : null;
    if (transient) {
      if (port.processorId) {
        module.host.modulateNodeProcessor(port.processorId, effects);
      }
      return;
    }
    const used = [...(plan?.edges.values() ?? [])].some(
      (edge) => edge.source === node.id && edge.sourceHandle === handle
    );
    if (!used) {
      return;
    }
    if (!port.processorId) {
      revision += 1;
      port.processorId = processorId(node.id, `${handle}:${revision}`);
      port.effects = effects;
      track(
        module.host.connectNodeProcessor(
          port.processorId,
          module.input,
          port.out,
          effects,
          key
        )
      );
    } else if (JSON.stringify(port.effects) !== JSON.stringify(effects)) {
      port.effects = effects;
      track(module.host.updateNodeProcessor(port.processorId, effects, key));
    }
  };
  const updateModule = (
    node: GraphNode,
    module: Module,
    transient: boolean
  ) => {
    if (!transient) {
      syncKey(module, hasKey(node.id));
    }
    for (const [handle, port] of module.ports) {
      updateNative(node, port.out);
      if (getNodeDefinition(node.type).effectType) {
        updatePort(node, module, handle, port, transient);
      }
    }
  };
  const cableLevel = (edge: GraphEdge) => {
    const source = plan?.nodes.get(edge.source);
    const sink = plan?.nodes.get(edge.target);
    const branch =
      source?.type === "fxComposite" ||
      source?.type === "stereoSplit" ||
      source?.type === "frequencySplit";
    const solo =
      branch &&
      [...(plan?.edges.values() ?? [])].some(
        (other) => other.source === edge.source && other.solo
      );
    return edge.muted ||
      (solo && !edge.solo) ||
      (sink?.type === "deviceOut" && sink.data.muted)
      ? 0
      : edge.gain;
  };
  const syncModules = () => {
    for (const [id, module] of modules) {
      if (plan?.nodes.get(id)?.type !== module.type) {
        modules.delete(id);
        track(wait(FADE_MS).then(() => releaseModule(module)));
      }
    }
    for (const node of plan?.nodes.values() ?? []) {
      let module = modules.get(node.id);
      if (!module) {
        module = createModule(node);
        modules.set(node.id, module);
      }
      updateModule(node, module, false);
    }
  };
  const cableEnds = (edge: GraphEdge | undefined) => {
    const source = edge
      ? modules.get(edge.source)?.ports.get(edge.sourceHandle)?.out
      : undefined;
    const module = edge ? modules.get(edge.target) : undefined;
    const target =
      edge?.targetHandle === "in:sidechain:key" ? module?.key : module?.input;
    return { source, target };
  };
  const wantsPan = (edge: GraphEdge) => {
    const source = plan?.nodes.get(edge.source);
    return (
      edge.pan !== undefined ||
      (source !== undefined &&
        ["fxComposite", "stereoSplit", "frequencySplit"].includes(source.type))
    );
  };
  const createCable = (
    edge: GraphEdge,
    source: AudioNode,
    target: AudioNode
  ): Cable => {
    const gain = source.context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    const pan = wantsPan(edge) ? source.context.createStereoPanner() : null;
    if (pan) {
      gain.connect(pan);
      pan.connect(target);
    } else {
      gain.connect(target);
    }
    return { gain, pan, source, target };
  };
  const keepsCable = (id: string, cable: Cable) => {
    const edge = plan?.edges.get(id);
    const { source, target } = cableEnds(edge);
    return (
      source === cable.source &&
      target === cable.target &&
      edge !== undefined &&
      Boolean(cable.pan) === wantsPan(edge)
    );
  };
  const syncCables = () => {
    for (const [id, cable] of cables) {
      if (!keepsCable(id, cable)) {
        dropCable(id, cable);
      }
    }
    for (const edge of plan?.edges.values() ?? []) {
      const { source, target } = cableEnds(edge);
      if (!(source && target)) {
        continue;
      }
      let cable = cables.get(edge.id);
      if (!cable) {
        cable = createCable(edge, source, target);
        cables.set(edge.id, cable);
      }
      ramp(cable.gain.gain, cableLevel(edge));
      if (cable.pan) {
        ramp(cable.pan.pan, edge.pan ?? 0);
      }
    }
  };
  const update = () => {
    if (context && plan) {
      syncModules();
      syncCables();
    }
  };
  const dispose = () => {
    for (const cable of cables.values()) {
      releaseCable(cable);
    }
    cables.clear();
    for (const module of modules.values()) {
      releaseModule(module);
    }
    modules.clear();
    context = null;
  };
  return {
    connectSource(id: string, source: AudioNode) {
      if (context !== source.context || host !== getHost()) {
        dispose();
        ({ context } = source);
        host = getHost();
        update();
      }
      const input = modules.get(id)?.input;
      if (!input) {
        return () => undefined;
      }
      source.connect(input);
      return () =>
        safeDisconnectFrom(source, input, "NodeAudioPatch.disconnectSource");
    },
    dispose() {
      plan = undefined;
      dispose();
    },
    getTap(id: string, handle = MAIN): AudioNode | null {
      const module = modules.get(id);
      return module?.type === "follower"
        ? module.input
        : (module?.ports.get(handle)?.out ?? null);
    },
    modulate(next: AudioPatchPlan) {
      for (const node of next.nodes.values()) {
        const module = modules.get(node.id);
        if (module) {
          updateModule(node, module, true);
        }
      }
    },
    outcomes() {
      return [...modules].map(([id, module]) => ({
        id,
        outcomes: [...module.ports.values()].flatMap((port) =>
          port.processorId && port.effects?.some((effect) => effect.enabled)
            ? [module.host.getEffectsRuntimeOutcome(port.processorId)]
            : []
        ),
      }));
    },
    reroute() {
      // Device changes affect the sink connection, never its upstream processing.
      for (const [id, module] of modules) {
        if (module.sinkRelease) {
          module.sinkRelease();
          module.sinkRelease = route(id, module.input);
        }
      }
    },
    sync(next: AudioPatchPlan | undefined) {
      plan = next;
      if (!next) {
        dispose();
        return;
      }
      update();
    },
    async whenSettled() {
      while (pending.size > 0) {
        // biome-ignore lint/performance/noAwaitInLoops: startup and teardown can enqueue follow-up work
        await Promise.allSettled([...pending]);
      }
    },
  };
}
