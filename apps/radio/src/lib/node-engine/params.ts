import { isOfficialOpenDawEffect } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import { getEffectMidiParamDefs } from "@/lib/audio/dsp/effects/param-traversal";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  findEffectInTree,
  isEffectContainer,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
import type { EffectWriteResult } from "@/lib/audio/manager/effects-graph-runtime";
import { isCoupledParameter } from "@/lib/audio/manager/official-modulation-target";
import type { LanePlan } from "@/lib/node-graph/compile";
import { FILTER_PARAM_BOUNDS } from "@/lib/node-graph/schema";
import { clampParam, type EngineParamTarget, paramKey } from "./param-target";

type EffectTarget = Extract<EngineParamTarget, { kind: "effect" | "chain" }>;
type LaneParamTarget = Exclude<EngineParamTarget, { kind: "send" }>;
type Overlay = { target: LaneParamTarget; value: number };
const PARAM_BOUNDS = {
  gain: { max: Number.POSITIVE_INFINITY, min: 0 },
  pan: { max: 1, min: -1 },
  ...FILTER_PARAM_BOUNDS,
};

function effectParamOwner(config: EffectConfig, target: EffectTarget) {
  if (target.kind === "effect") {
    return config;
  }
  return isEffectContainer(config)
    ? config.chains.find((chain) => chain.id === target.chainId)
    : undefined;
}

/**
 * What an effects owner's parameters read their authored values from: a
 * lane's plan, or a graph unit's, which has no strip.
 */
type ParamPlan = Pick<LanePlan, "effects" | "backend"> &
  Partial<Pick<LanePlan, "pan" | "filter">>;

type ParamHost = {
  /** The owner's effects id: a lane's sound, or a unit's insert. */
  soundId: string;
  plan: () => ParamPlan | null;
  active: () => boolean;
  audio: Pick<
    AudioManager,
    "getStripNodes" | "getEffectsRuntimeOutcome" | "hasEffectModulationField"
  >;
  nodes?: () => { pan?: StereoPannerNode; filter?: BiquadFilterNode } | null;
  effects: Pick<AudioManager, "setEffectFields">;
};

function readAuthored(host: ParamHost, target: LaneParamTarget) {
  const plan = host.plan();
  if (target.kind === "pan" || target.kind === "filter") {
    const field = target.kind === "pan" ? "pan" : target.field;
    const value =
      target.kind === "pan" ? plan?.pan : plan?.filter?.[target.field];
    return value === undefined
      ? undefined
      : { bounds: PARAM_BOUNDS[field], effect: undefined, value };
  }
  const config = findEffectInTree(plan?.effects ?? [], target.effectId);
  if (
    !(config && isOfficialOpenDawEffect(config)) ||
    target.field === "order" ||
    config.type === "werkstatt"
  ) {
    return;
  }
  const value =
    Reflect.get(effectParamOwner(config, target) ?? {}, target.field) ??
    (target.field === "signalGain" ? 1 : undefined);
  const effectBounds = ["signalGain", "outputGain"].includes(target.field)
    ? { max: Number.POSITIVE_INFINITY, min: 0 }
    : getEffectMidiParamDefs(config.type).find(
        (param) => param.key === target.field
      );
  const bounds =
    target.kind === "chain" ? PARAM_BOUNDS[target.field] : effectBounds;
  return typeof value === "number" && bounds
    ? { bounds, effect: config, value }
    : undefined;
}

/**
 * Scalar overlays belong to one effects owner, a lane's sound or a graph
 * unit; baselines always come from its latest plan.
 */
export function createParameters(host: ParamHost) {
  let transient = new Map<string, Overlay>();

  function available(target: EngineParamTarget): boolean {
    const plan = host.plan();
    const outcome = host.audio.getEffectsRuntimeOutcome(host.soundId);
    return (
      host.active() &&
      Boolean(plan) &&
      (target.kind === "send" || resolves(target)) &&
      outcome.backend !== "compatibility" &&
      (!("effectId" in target) || outcome.status !== "failed") &&
      plan?.backend !== "compat"
    );
  }

  function resolves(target: LaneParamTarget): boolean {
    const authored = readAuthored(host, target);
    return Boolean(
      authored &&
        (!authored.effect ||
          isCoupledParameter(
            { config: authored.effect },
            target as EffectTarget
          ) ||
          host.audio.hasEffectModulationField(
            host.soundId,
            target as EffectTarget
          ))
    );
  }

  function set(target: LaneParamTarget, requested?: number): EffectWriteResult {
    const authored = readAuthored(host, target);
    const supported = available(target);
    if (requested !== undefined && !(authored && supported)) {
      return "unavailable";
    }
    let value = authored?.value;
    const key = paramKey(target);
    const previous = transient;
    transient = new Map(previous);
    transient.delete(key);
    if (requested !== undefined) {
      const { min, max } = authored?.bounds ?? {};
      value = clampParam(requested, min, max);
      transient.set(key, { target, value });
    }
    let result: EffectWriteResult | undefined;
    try {
      result =
        authored !== undefined &&
        host.active() &&
        (supported || !("effectId" in target))
          ? write(target, value ?? authored.value, authored.effect)
          : "applied";
      return result;
    } finally {
      if (result !== "applied") {
        transient = previous;
      }
    }
  }

  function clear(target?: LaneParamTarget): void {
    const targets = target
      ? [target]
      : [...transient.values()].map((entry) => entry.target);
    for (const current of targets) {
      if (transient.has(paramKey(current))) {
        set(current);
      }
    }
  }

  function write(
    target: LaneParamTarget,
    value: number,
    effect?: EffectConfig
  ): EffectWriteResult {
    if ("effectId" in target) {
      return effect ? writeEffect(effect) : "unavailable";
    }
    const nodes = host.nodes
      ? host.nodes()
      : host.audio.getStripNodes(host.soundId);
    if (nodes) {
      const param =
        target.kind === "pan" ? nodes.pan?.pan : nodes.filter?.[target.field];
      const context = (nodes.pan ?? nodes.filter)?.context;
      if (context) {
        param?.setTargetAtTime(value, context.currentTime, 0.01);
      }
    }
    return "applied";
  }

  function writeEffect(authored: EffectConfig): EffectWriteResult {
    const { audio, effects, soundId } = host;
    const config = { ...authored };
    if (isEffectContainer(config)) {
      config.chains = config.chains.map((chain) => ({ ...chain }));
    }
    for (const { target, value } of transient.values()) {
      if ("effectId" in target && target.effectId === authored.id) {
        Object.assign(effectParamOwner(config, target) ?? {}, {
          [target.field]: value,
        });
      }
    }
    const { backend } = audio.getEffectsRuntimeOutcome(soundId);
    const result =
      backend === "official"
        ? effects.setEffectFields(soundId, authored.id, config, true)
        : "applied";
    return result === "unavailable" ? "applied" : result;
  }

  function reapply(scope?: "strip" | { effectId: string }): void {
    const effects = new Map<string, EffectConfig>();
    const overlays = [...transient.values()].filter(({ target }) =>
      scope === "strip"
        ? !("effectId" in target)
        : !scope || ("effectId" in target && target.effectId === scope.effectId)
    );
    for (const { target, value } of overlays) {
      const authored = readAuthored(host, target);
      if (!(available(target) && authored)) {
        clear(target);
      } else if (authored.effect) {
        effects.set(authored.effect.id, authored.effect);
      } else {
        write(target, value);
      }
    }
    for (const config of effects.values()) {
      try {
        writeEffect(config);
      } catch (error) {
        console.warn(
          "[NodePlayback] Could not replay effect overlays",
          config.id,
          error
        );
      }
    }
  }

  return { available, clear, reapply, retire: clear, set };
}

export type OwnerParameters = ReturnType<typeof createParameters>;
