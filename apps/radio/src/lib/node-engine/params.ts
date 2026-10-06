import { isOfficialOpenDawEffect } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  findEffectInTree,
  isEffectContainer,
  updateEffectInTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
import type {
  EffectLayoutRequirements,
  EffectWriteResult,
} from "@/lib/audio/manager/effects-graph-runtime";
import type { LanePlan } from "@/lib/node-graph/compile";
import {
  type EngineParamTarget,
  type ParamMode,
  paramKey,
} from "./param-target";

type LaneTarget = Exclude<EngineParamTarget, { kind: "send" }>;
type EffectTarget = Extract<LaneTarget, { kind: "effect" | "chain" }>;

export function readLaneParam(
  plan: LanePlan,
  target: LaneTarget
): number | undefined {
  switch (target.kind) {
    case "pan":
      return plan.pan;
    case "filter":
      return plan.filter?.[target.field];
    case "effect": {
      const config = findEffectInTree(plan.effects, target.effectId);
      if (
        !(config && isOfficialOpenDawEffect(config)) ||
        target.field === "order"
      ) {
        return undefined;
      }
      const value = (config as unknown as Record<string, unknown>)[
        target.field
      ];
      if (target.field === "signalGain") {
        return config.signalGain ?? 1;
      }
      return typeof value === "number" ? value : undefined;
    }
    case "chain": {
      const config = findEffectInTree(plan.effects, target.effectId);
      return config && isEffectContainer(config)
        ? config.chains.find((chain) => chain.id === target.chainId)?.[
            target.field
          ]
        : undefined;
    }
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function withEffectParam(
  config: EffectConfig,
  target: EffectTarget,
  value: number
): EffectConfig {
  if (target.kind === "effect") {
    return { ...config, [target.field]: value };
  }
  return isEffectContainer(config)
    ? {
        ...config,
        chains: config.chains.map((chain) =>
          chain.id === target.chainId
            ? { ...chain, [target.field]: value }
            : chain
        ),
      }
    : config;
}

export function withLaneParam(
  plan: LanePlan,
  target: LaneTarget,
  value: number
): LanePlan {
  switch (target.kind) {
    case "pan":
      return { ...plan, pan: Math.max(-1, Math.min(1, value)) };
    case "filter":
      return {
        ...plan,
        filter: plan.filter ? { ...plan.filter, [target.field]: value } : null,
      };
    case "effect":
    case "chain": {
      const config = findEffectInTree(plan.effects, target.effectId);
      return config
        ? {
            ...plan,
            effects: updateEffectInTree(
              plan.effects,
              target.effectId,
              withEffectParam(config, target, value)
            ),
          }
        : plan;
    }
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

type ParamHost = {
  soundId: string;
  plan: () => LanePlan | null;
  active: () => boolean;
  audio: Pick<AudioManager, "getStripNodes" | "getEffectsRuntimeOutcome">;
  effects: Pick<AudioManager, "setEffectFields" | "writeTransientEffect">;
  sendGain: (edgeId: string) => number | undefined;
  author: (target: EngineParamTarget, value: number) => void;
  refreshSends: () => void;
  wake: () => void;
};

/** Scalar overlays belong to one sound; all baselines are read from its latest plan. */
export class LaneParameters {
  readonly transient = new Map<string, number>();
  private readonly pending = new Set<string>();
  private readonly host: ParamHost;

  constructor(host: ParamHost) {
    this.host = host;
  }

  available(): boolean {
    const plan = this.host.plan();
    const outcome = this.host.audio.getEffectsRuntimeOutcome(this.host.soundId);
    return (
      this.host.active() &&
      Boolean(plan) &&
      outcome.backend !== "compatibility" &&
      outcome.status !== "failed" &&
      (outcome.backend === "official" || plan?.backend !== "compat")
    );
  }

  private authored(target: EngineParamTarget): number | undefined {
    const plan = this.host.plan();
    if (target.kind === "send") {
      return this.host.sendGain(target.edgeId);
    }
    return plan ? readLaneParam(plan, target) : undefined;
  }

  set(
    target: EngineParamTarget,
    value: number,
    mode: ParamMode
  ): EffectWriteResult {
    if (
      !(this.available() && Number.isFinite(value)) ||
      this.authored(target) === undefined
    ) {
      return "unavailable";
    }
    if (mode === "transient") {
      this.transient.set(paramKey(target), value);
      return this.write(target, value);
    }
    if (target.kind === "effect" || target.kind === "chain") {
      const config = findEffectInTree(
        this.host.plan()?.effects ?? [],
        target.effectId
      );
      if (!config) {
        return "unavailable";
      }
      const result = this.host.effects.setEffectFields(
        this.host.soundId,
        target.effectId,
        withEffectParam(config, target, value)
      );
      if (typeof result !== "string") {
        return "structural";
      }
      if (result !== "applied") {
        return result;
      }
    }
    this.host.author(target, value);
    return this.write(target, this.transient.get(paramKey(target)) ?? value);
  }

  clear(target?: EngineParamTarget): void {
    const targets = target
      ? [target]
      : [...this.transient.keys()].map(
          (key) => JSON.parse(key) as EngineParamTarget
        );
    for (const current of targets) {
      if (!this.transient.delete(paramKey(current))) {
        continue;
      }
      const value = this.authored(current);
      if (value !== undefined && this.available()) {
        this.write(current, value);
      }
    }
  }

  private write(target: EngineParamTarget, value: number): EffectWriteResult {
    switch (target.kind) {
      case "effect":
      case "chain":
        return this.writeEffect(target.effectId);
      case "send":
        this.host.refreshSends();
        return "applied";
      case "pan":
      case "filter": {
        const nodes = this.host.audio.getStripNodes(this.host.soundId);
        if (nodes) {
          const param =
            target.kind === "pan" ? nodes.pan.pan : nodes.filter[target.field];
          const effective =
            target.kind === "pan" ? Math.max(-1, Math.min(1, value)) : value;
          param.setTargetAtTime(effective, nodes.pan.context.currentTime, 0.01);
        }
        return "applied";
      }
      default: {
        const exhaustive: never = target;
        return exhaustive;
      }
    }
  }

  private writeEffect(effectId: string, prepare = false): EffectWriteResult {
    let config = findEffectInTree(this.host.plan()?.effects ?? [], effectId);
    if (!config) {
      return "unavailable";
    }
    const requirements: EffectLayoutRequirements = {
      signalTrim: false,
      wrapper: false,
    };
    for (const [key, value] of this.transient) {
      const target = JSON.parse(key) as EngineParamTarget;
      if (
        (target.kind !== "effect" && target.kind !== "chain") ||
        target.effectId !== effectId
      ) {
        continue;
      }
      if (target.kind === "effect") {
        requirements.wrapper ||= ["dryWet", "inputGain", "outputGain"].includes(
          target.field
        );
        requirements.signalTrim ||= target.field === "signalGain";
      }
      config = withEffectParam(config, target, value);
    }
    if (
      this.host.audio.getEffectsRuntimeOutcome(this.host.soundId).backend !==
      "official"
    ) {
      return "applied";
    }
    const result = this.host.effects.writeTransientEffect(
      this.host.soundId,
      effectId,
      config,
      requirements,
      prepare
    );
    if (result === "structural") {
      this.pending.add(effectId);
      this.host.wake();
      return "applied";
    }
    return result;
  }

  /** The lane's serial driver prepares/restores endpoint layouts. */
  prepare(): void {
    if (this.pending.size === 0 || !this.available()) {
      return;
    }
    for (const id of this.pending) {
      this.writeEffect(id, true);
    }
    this.pending.clear();
  }

  reapply(): void {
    if (this.transient.size === 0) {
      return;
    }
    if (!this.available()) {
      if (this.host.active()) {
        for (const key of this.transient.keys()) {
          const target = JSON.parse(key) as EngineParamTarget;
          const value = this.authored(target);
          if (
            value !== undefined &&
            target.kind !== "effect" &&
            target.kind !== "chain"
          ) {
            this.write(target, value);
          }
        }
        this.retire();
      }
      return;
    }
    const effects = new Set<string>();
    for (const [key, value] of this.transient) {
      const target = JSON.parse(key) as EngineParamTarget;
      if (this.authored(target) === undefined) {
        this.transient.delete(key);
        continue;
      }
      if (target.kind === "effect" || target.kind === "chain") {
        effects.add(target.effectId);
      } else {
        this.write(target, value);
      }
    }
    for (const id of effects) {
      this.writeEffect(id);
    }
  }

  retire(): void {
    this.transient.clear();
    this.pending.clear();
  }
}
