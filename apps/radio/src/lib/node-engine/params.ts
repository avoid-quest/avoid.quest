import { MAX_CHAIN_GAIN } from "@/lib/audio/dsp/effects/effect-config-schema";
import { isOfficialOpenDawEffect } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import { getEffectMidiParamDefs } from "@/lib/audio/dsp/effects/param-traversal";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  effectFieldsAreStructural,
  findEffectInTree,
  isEffectContainer,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
import type { EffectWriteResult } from "@/lib/audio/manager/effects-graph-runtime";
import type { LanePlan } from "@/lib/node-graph/compile";
import { FILTER_PARAM_BOUNDS } from "@/lib/node-graph/schema";
import { clampParam, type EngineParamTarget, paramKey } from "./param-target";

type EffectTarget = Extract<EngineParamTarget, { kind: "effect" | "chain" }>;
type LaneParamTarget = Exclude<EngineParamTarget, { kind: "send" }>;
type Overlay = { target: LaneParamTarget; value: number };
const PARAM_BOUNDS = {
  gain: { max: MAX_CHAIN_GAIN, min: 0 },
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

type ParamHost = {
  soundId: string;
  plan: () => LanePlan | null;
  active: () => boolean;
  audio: Pick<AudioManager, "getStripNodes" | "getEffectsRuntimeOutcome">;
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
  const bounds =
    target.kind === "chain"
      ? PARAM_BOUNDS[target.field]
      : getEffectMidiParamDefs(config.type).find(
          (param) => param.key === target.field
        );
  return typeof value === "number"
    ? { bounds, effect: config, value }
    : undefined;
}

/** Scalar overlays belong to one sound; baselines always come from its latest plan. */
export function createLaneParameters(host: ParamHost) {
  let transient = new Map<string, Overlay>();

  function available(target: EngineParamTarget): boolean {
    const plan = host.plan();
    const outcome = host.audio.getEffectsRuntimeOutcome(host.soundId);
    return (
      host.active() &&
      Boolean(plan) &&
      outcome.backend !== "compatibility" &&
      (!("effectId" in target) || outcome.status !== "failed") &&
      plan?.backend !== "compat"
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
    const nodes = host.audio.getStripNodes(host.soundId);
    if (nodes) {
      const param =
        target.kind === "pan" ? nodes.pan.pan : nodes.filter[target.field];
      param.setTargetAtTime(value, nodes.pan.context.currentTime, 0.01);
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
    if (effectFieldsAreStructural(authored, config)) {
      return "structural";
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
      writeEffect(config);
    }
  }

  return { available, clear, reapply, retire: () => transient.clear(), set };
}
