import type { AudioPatchPlan } from "@/lib/node-graph/audio-patch-plan";
import {
  branchBaseMuted,
  branchBaseSolo,
  branchIndex,
  isSplitNode,
} from "@/lib/node-graph/branches";
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
type Port = {
  out: AudioNode;
  processorId?: string;
  effects?: EffectConfig[];
  retirement?: object;
};
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

/** A configured chain solo or any of its cable solos activates the branch. */
function splitSoloBranches(node: GraphNode, outgoing: readonly GraphEdge[]) {
  const solos = new Set<number>();
  if (!isSplitNode(node)) {
    return solos;
  }
  const { effect } = node.data;
  if (isEffectContainer(effect)) {
    [...effect.chains]
      .sort((a, b) => a.order - b.order)
      .forEach((chain, index) => {
        if (chain.solo) {
          solos.add(index + 1);
        }
      });
  }
  for (const edge of outgoing) {
    if (edge.solo) {
      solos.add(branchIndex(edge.sourceHandle));
    }
  }
  return solos;
}

/** Mix dry routing and wet branch controls after channel/band separation. */
function splitBranchMix(
  chain: EffectChainConfig,
  effect: EffectConfig,
  dryShare: number
): EffectChainConfig {
  const wet = effect.enabled ? effect.dryWet : 0;
  const wetGain = wet * effect.inputGain * chain.gain;
  const dryGain = (1 - wet) * dryShare;
  if (effect.type === "fxComposite") {
    const angle = ((chain.pan + 1) * Math.PI) / 4;
    const left = wetGain * Math.cos(angle) + dryGain;
    const right = wetGain * Math.sin(angle) + dryGain;
    return {
      ...chain,
      gain: Math.hypot(left, right),
      pan:
        left === 0 && right === 0
          ? 0
          : (4 * Math.atan2(right, left)) / Math.PI - 1,
    };
  }
  const gain = wetGain + dryGain;
  return { ...chain, gain, pan: gain === 0 ? 0 : (wetGain * chain.pan) / gain };
}

/** One branch's signal, without copying any downstream processors. */
export function patchPortEffects(
  node: GraphNode,
  handle: string,
  keyed: boolean,
  options: { soloBranches?: ReadonlySet<number>; dryShare?: number } = {}
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
    const solos =
      options.soloBranches ??
      new Set(
        chains.flatMap((chain, order) => (chain.solo ? [order + 1] : []))
      );
    const mix = (chain: EffectChainConfig, order: number) => ({
      ...splitBranchMix(
        chain,
        effect,
        effect.type === "fxComposite"
          ? (options.dryShare ?? 1 / Math.max(1, chains.length))
          : 1
      ),
      effects: [],
      muted:
        chain.muted ||
        order !== index ||
        (solos.size > 0 && !solos.has(order + 1)),
      solo: false,
    });
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
        chains: [{ ...mix(selected, index), order: 0 }],
      };
    } else {
      effect = {
        ...effect,
        chains: chains.map(mix),
      };
    }
    // Ports keep routing while bypassed. Each port carries only its share of
    // dry audio, so joining different outputs cannot clone the unsplit input.
    effect = {
      ...effect,
      dryWet: 1,
      enabled: true,
      inputGain: 1,
      outputGain: authored.enabled ? authored.outputGain : 1,
    };
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
      port.retirement = undefined;
      if (port.processorId) {
        module.host.releaseNodeProcessor(port.processorId);
        port.processorId = undefined;
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
        cableLevel(edge) > 0
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
  const retirePort = (module: Module, port: Port) => {
    if (!port.processorId || port.retirement) {
      return;
    }
    const retirement = {};
    port.retirement = retirement;
    track(
      wait(FADE_MS).then(() => {
        if (port.retirement !== retirement) {
          return;
        }
        if (port.processorId) {
          module.host.releaseNodeProcessor(port.processorId);
        }
        port.processorId = undefined;
        port.effects = undefined;
        port.retirement = undefined;
      })
    );
  };
  const updatePort = (
    node: GraphNode,
    module: Module,
    handle: string,
    port: Port,
    transient: boolean
  ) => {
    const keyed = hasKey(node.id);
    const outgoing = [...(plan?.edges.values() ?? [])].filter(
      (edge) => edge.source === node.id
    );
    const effects = patchPortEffects(node, handle, keyed, {
      dryShare:
        1 /
        Math.max(1, new Set(outgoing.map((edge) => edge.sourceHandle)).size),
      soloBranches: splitSoloBranches(node, outgoing),
    });
    const key = keyed ? module.keyId : null;
    if (transient) {
      if (port.processorId) {
        module.host.modulateNodeProcessor(port.processorId, effects);
      }
      return;
    }
    const used = outgoing.some((edge) => edge.sourceHandle === handle);
    if (!used) {
      retirePort(module, port);
      return;
    }
    port.retirement = undefined;
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
    const branch = isSplitNode(source);
    const configuredSolo = branch && branchBaseSolo(source, edge.sourceHandle);
    const effect = branch ? source.data.effect : undefined;
    const solo =
      branch &&
      ((effect &&
        isEffectContainer(effect) &&
        effect.chains.some((chain) => chain.solo)) ||
        [...(plan?.edges.values() ?? [])].some(
          (other) => other.source === edge.source && other.solo
        ));
    return edge.muted ||
      (branch && branchBaseMuted(source, edge.sourceHandle)) ||
      (solo && !configuredSolo && !edge.solo) ||
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
