import { dbToGain } from "@opendaw/lib-dsp";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { findEffectInTree } from "@/lib/audio/dsp/routing/effect-tree";
import { isCoupledParameter } from "@/lib/audio/manager/official-modulation-target";
import type { EngineParamTarget } from "@/lib/node-engine/param-target";
import { isEffectNodeType } from "./catalogue";
import type { EnginePlan } from "./compile";
import { modulationParameters } from "./modulation-parameters";
import { type GraphNode, isStripSource, type NodeGraph } from "./schema";

export type ParamBinding = {
  target: EngineParamTarget;
  base: number;
  authored: number;
  kind: "gain" | "value" | "pan" | "wet" | "dry";
  coupled: boolean;
  factor?: number;
};

export function parameterValue(
  node: GraphNode,
  key: string
): number | undefined {
  let owner: object = node.data;
  if (isStripSource(node)) {
    owner = node.data.strip;
  } else if (isEffectNodeType(node.type)) {
    owner = (node.data as { effect: object }).effect;
  }
  const value: unknown = Reflect.get(owner, key);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Compiler provenance resolves folded Gains and fan-out without probe compiles. */
export function bindParam(
  graph: NodeGraph,
  nodeId: string,
  key: string,
  plan: EnginePlan
): ParamBinding[] {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  const authored = node && parameterValue(node, key);
  if (
    !node ||
    authored === undefined ||
    !modulationParameters(node).some((range) => range.key === key)
  ) {
    return [];
  }
  let source = nodeId;
  if (isStripSource(node)) {
    source = `${nodeId}:strip.${key}`;
  } else if (isEffectNodeType(node.type)) {
    source = `${nodeId}:${key}`;
  }
  const bindings = plan.gains
    .filter(
      (entry) =>
        (entry.sources.includes(source) ||
          (key === "dryWet" && entry.sources.includes(`${nodeId}:dry`))) &&
        (entry.target.kind !== "filter" || entry.target.field === key)
    )
    .map(({ target, value, factor, sources }): ParamBinding => {
      let kind: ParamBinding["kind"] = "value";
      if (key === "gainDb" || key === "trimDb") {
        kind = "gain";
      } else if (target.kind === "pan") {
        kind = "pan";
      } else if (target.kind === "send") {
        kind =
          sources.includes(`${nodeId}:dry`) && key === "dryWet" ? "dry" : "wet";
      }
      return {
        authored,
        base: value,
        coupled: "effectId" in target,
        factor,
        kind,
        target,
      };
    });
  if (bindings.length) {
    return bindings;
  }
  for (const lane of [...plan.lanes.values(), ...plan.units.values()]) {
    const effect = findEffectInTree(lane.effects, nodeId);
    if (effect) {
      const resolved = effectBinding(
        node,
        key,
        authored,
        effect,
        lane.id,
        plan
      );
      return resolved ? [resolved] : [];
    }
  }
  return [];
}

function effectBinding(
  node: GraphNode,
  key: string,
  authored: number,
  effect: EffectConfig,
  laneId: string,
  plan: EnginePlan
): ParamBinding | undefined {
  let field = key;
  let kind: ParamBinding["kind"] = "value";
  if (node.type === "filter") {
    kind = key === "Q" ? "gain" : "value";
    field = `${node.data.type === "lowpass" ? "lowPass" : "highPass"}${key === "Q" ? "Q" : "Frequency"}`;
  }
  const target = {
    effectId: effect.id,
    field,
    kind: "effect" as const,
    laneId,
  };
  let base: unknown = Reflect.get(effect, field);
  if (typeof base !== "number") {
    return;
  }
  // A zero linear base stores its multiplier so the control can open again.
  if (authored === 0 && kind === "value") {
    base =
      field === "outputGain"
        ? (plan.gains.find(
            (entry) =>
              entry.target.kind === "effect" &&
              entry.target.effectId === effect.id &&
              entry.target.field === field
          )?.factor ?? 1)
        : 1;
  }
  return {
    authored,
    base: base as number,
    coupled:
      (node.type === "filter" && key === "Q") ||
      isCoupledParameter({ config: effect }, target),
    kind,
    target,
  };
}

export function mapParamValue(binding: ParamBinding, value: number): number {
  if (binding.kind === "wet" || binding.kind === "dry") {
    const ratio =
      binding.kind === "dry"
        ? (1 - value) / (1 - binding.authored || 1)
        : value / (binding.authored || 1);
    return (binding.factor ?? binding.base) * ratio;
  }
  if (binding.kind === "gain") {
    return value === binding.authored
      ? binding.base
      : binding.base * dbToGain(value - binding.authored);
  }
  if (binding.kind === "pan") {
    return binding.base + value - binding.authored;
  }
  if (binding.base === binding.authored) {
    return value;
  }
  return (
    value *
    (binding.authored === 0 ? binding.base : binding.base / binding.authored)
  );
}
