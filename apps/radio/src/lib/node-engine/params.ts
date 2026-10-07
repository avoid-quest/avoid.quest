import { isOfficialOpenDawEffect } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  effectFieldsAreStructural,
  findEffectInTree,
  isEffectContainer,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
import type { EffectWriteResult } from "@/lib/audio/manager/effects-graph-runtime";
import type { LanePlan } from "@/lib/node-graph/compile";
import { type EngineParamTarget, paramKey } from "./param-target";

type EffectTarget = Extract<EngineParamTarget, { kind: "effect" | "chain" }>;
type LaneParamTarget = Exclude<EngineParamTarget, { kind: "send" }>;

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

type ParamHost = {
  soundId: string;
  plan: () => LanePlan | null;
  active: () => boolean;
  audio: Pick<AudioManager, "getStripNodes" | "getEffectsRuntimeOutcome">;
  effects: Pick<AudioManager, "setEffectFields">;
};

/** Scalar overlays belong to one sound; baselines always come from its latest plan. */
export class LaneParameters {
  private readonly transient = new Map<
    string,
    { target: LaneParamTarget; value: number }
  >();
  private readonly host: ParamHost;

  constructor(host: ParamHost) {
    this.host = host;
  }

  available(target: EngineParamTarget): boolean {
    const plan = this.host.plan();
    const outcome = this.host.audio.getEffectsRuntimeOutcome(this.host.soundId);
    return (
      this.host.active() &&
      Boolean(plan) &&
      outcome.backend !== "compatibility" &&
      (!("effectId" in target) || outcome.status !== "failed") &&
      plan?.backend !== "compat"
    );
  }

  private authored(target: LaneParamTarget): number | undefined {
    const plan = this.host.plan();
    if (target.kind === "pan") {
      return plan?.pan;
    }
    if (target.kind === "filter") {
      return plan?.filter?.[target.field];
    }
    const config = findEffectInTree(plan?.effects ?? [], target.effectId);
    if (!(config && isOfficialOpenDawEffect(config))) {
      return undefined;
    }
    if (target.kind === "chain") {
      return isEffectContainer(config)
        ? config.chains.find((chain) => chain.id === target.chainId)?.[
            target.field
          ]
        : undefined;
    }
    if (target.field === "order" || config.type === "werkstatt") {
      return undefined;
    }
    const value =
      target.field === "signalGain"
        ? (config.signalGain ?? 1)
        : (config as unknown as Record<string, unknown>)[target.field];
    return typeof value === "number" ? value : undefined;
  }

  set(target: LaneParamTarget, value: number): EffectWriteResult {
    if (
      !(this.available(target) && Number.isFinite(value)) ||
      this.authored(target) === undefined
    ) {
      return "unavailable";
    }
    const result = this.write(target, value);
    if (result === "applied") {
      this.transient.set(paramKey(target), { target, value });
    }
    return result;
  }

  clear(target?: LaneParamTarget): void {
    const targets = target
      ? [target]
      : [...this.transient.values()].map((entry) => entry.target);
    for (const current of targets) {
      if (!this.transient.delete(paramKey(current))) {
        continue;
      }
      const value = this.authored(current);
      if (
        value !== undefined &&
        this.host.active() &&
        (this.available(current) || !("effectId" in current))
      ) {
        this.write(current, value);
      }
    }
  }

  private write(target: LaneParamTarget, value: number): EffectWriteResult {
    if ("effectId" in target) {
      return this.writeEffect(target.effectId, { target, value });
    }
    const nodes = this.host.audio.getStripNodes(this.host.soundId);
    if (nodes) {
      const param =
        target.kind === "pan" ? nodes.pan.pan : nodes.filter[target.field];
      param.setTargetAtTime(
        target.kind === "pan" ? Math.max(-1, Math.min(1, value)) : value,
        nodes.pan.context.currentTime,
        0.01
      );
    }
    return "applied";
  }

  private writeEffect(
    effectId: string,
    overlay?: { target: EffectTarget; value: number }
  ): EffectWriteResult {
    let config = findEffectInTree(this.host.plan()?.effects ?? [], effectId);
    if (!config) {
      return "unavailable";
    }
    const authored = config;
    for (const { target, value } of this.transient.values()) {
      if ("effectId" in target && target.effectId === effectId) {
        config = withEffectParam(config, target, value);
      }
    }
    if (overlay) {
      config = withEffectParam(config, overlay.target, overlay.value);
    }
    if (effectFieldsAreStructural(authored, config)) {
      return "structural";
    }
    if (
      this.host.audio.getEffectsRuntimeOutcome(this.host.soundId).backend !==
      "official"
    ) {
      return "applied";
    }
    const result = this.host.effects.setEffectFields(
      this.host.soundId,
      effectId,
      config,
      true
    );
    return result === "unavailable" ? "applied" : result;
  }

  reapply(scope?: "strip" | { effectId: string }): void {
    if (this.transient.size === 0) {
      return;
    }
    const effects = new Set<string>();
    for (const [key, { target, value }] of this.transient) {
      if (
        scope === "strip"
          ? target.kind !== "pan" && target.kind !== "filter"
          : scope &&
            (!("effectId" in target) || target.effectId !== scope.effectId)
      ) {
        continue;
      }
      if (!this.available(target)) {
        this.clear(target);
      } else if (this.authored(target) === undefined) {
        this.transient.delete(key);
      } else if ("effectId" in target) {
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
  }
}
