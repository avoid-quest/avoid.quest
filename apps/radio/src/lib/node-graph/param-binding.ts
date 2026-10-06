import { dbToGain } from "@opendaw/lib-dsp";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  isEffectContainer,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import {
  type EngineParamTarget,
  paramKey,
} from "@/lib/node-engine/param-target";
import { isEffectNodeType } from "./catalogue";
import { type CompileEnv, compile, type EnginePlan } from "./compile";
import { compiledPlan } from "./compiled-plan";
import {
  setEffectParams,
  setNativeParams,
  setSourceStrip,
} from "./graph-edits";
import { type GraphNode, isStripSource, type NodeGraph } from "./schema";

export type ParamMap =
  | { kind: "identity" }
  | { kind: "scale"; k: number }
  | { kind: "offset"; c: number };
export type ParamBinding = {
  target: EngineParamTarget;
  map: ParamMap;
  input: "value" | "decibels";
  authored: number;
  base: number;
};
export type ParamBindings = ParamBinding[] | "structural" | "unavailable";

type Scalar = { target: EngineParamTarget; value: number };

function scalars(plan: EnginePlan): Map<string, Scalar> {
  const values = new Map<string, Scalar>();
  const add = (target: EngineParamTarget, value: number) =>
    values.set(paramKey(target), { target, value });
  for (const lane of plan.lanes.values()) {
    add({ kind: "pan", laneId: lane.id }, lane.pan);
    if (lane.filter) {
      for (const field of ["frequency", "Q"] as const) {
        add({ field, kind: "filter", laneId: lane.id }, lane.filter[field]);
      }
    }
    visitEffectTree(lane.effects, (config) => {
      for (const [field, value] of Object.entries(config)) {
        if (typeof value === "number" && field !== "order") {
          add(
            { effectId: config.id, field, kind: "effect", laneId: lane.id },
            value
          );
        }
      }
      if (isEffectContainer(config)) {
        for (const chain of config.chains) {
          for (const field of ["gain", "pan"] as const) {
            add(
              {
                chainId: chain.id,
                effectId: config.id,
                field,
                kind: "chain",
                laneId: lane.id,
              },
              chain[field]
            );
          }
        }
      }
    });
  }
  for (const edge of plan.edges.values()) {
    add({ edgeId: edge.id, kind: "send" }, edge.gain);
  }
  return values;
}

function sameLayout(before: EnginePlan, after: EnginePlan): boolean {
  return (
    before.lanes.size === after.lanes.size &&
    before.edges.size === after.edges.size &&
    [...before.lanes].every(
      ([id, lane]) =>
        after.lanes.get(id)?.layoutSignature === lane.layoutSignature
    ) &&
    [...before.edges].every(([id, edge]) => {
      const next = after.edges.get(id);
      return next?.from.id === edge.from.id && next.to.id === edge.to.id;
    })
  );
}

function graphValue(node: GraphNode, key: string): unknown {
  if (key.startsWith("strip.") && isStripSource(node)) {
    return (node.data.strip as unknown as Record<string, unknown>)[
      key.slice(6)
    ];
  }
  const data = isEffectNodeType(node.type)
    ? (node.data as { effect: EffectConfig }).effect
    : node.data;
  return (data as unknown as Record<string, unknown>)[key];
}

function probe(
  graph: NodeGraph,
  node: GraphNode,
  key: string,
  value: number
): NodeGraph {
  if (key.startsWith("strip.")) {
    return setSourceStrip(graph, node.id, { [key.slice(6)]: value });
  }
  return isEffectNodeType(node.type)
    ? setEffectParams(graph, node.id, { [key]: value })
    : setNativeParams(graph, node.id, { [key]: value });
}

const near = (value: number, expected: number) =>
  Math.abs(value - expected) < 1e-9;

/** Resolve once on authored commits; the returned mappings need no graph at frame time. */
export function bindParam(
  graph: NodeGraph,
  nodeId: string,
  key: string,
  env: CompileEnv
): ParamBindings {
  const node = graph.nodes.find((current) => current.id === nodeId);
  const authored = node && graphValue(node, key);
  if (!node || typeof authored !== "number" || !Number.isFinite(authored)) {
    return "unavailable";
  }
  const plan = compiledPlan(graph, env);
  const decibels = key === "gainDb" || key === "strip.trimDb";
  const pan = key === "pan" || key === "strip.pan";
  const first = decibels || pan ? 0 : authored;
  const left = compile(probe(graph, node, key, first), env);
  const lanePan =
    [...left.lanes.values()].find((lane) => lane.nodes.includes(nodeId))?.pan ??
    0;
  let second = authored + Math.max(0.01, Math.abs(authored) * 0.01);
  if (decibels) {
    second = 6;
  } else if (pan) {
    second = lanePan < 0 ? 0.25 : -0.25;
  }
  const right = compile(probe(graph, node, key, second), env);
  if (!(sameLayout(plan, left) && sameLayout(plan, right))) {
    return "structural";
  }
  return resolveBindings(
    plan,
    left,
    right,
    decibels,
    authored,
    decibels ? dbToGain(first) : first,
    decibels ? dbToGain(second) : second
  );
}

function resolveBindings(
  plan: EnginePlan,
  left: EnginePlan,
  right: EnginePlan,
  decibels: boolean,
  authored: number,
  x0: number,
  x1: number
): ParamBindings {
  const baseline = scalars(plan);
  const before = scalars(left);
  const after = scalars(right);

  const bindings: ParamBinding[] = [];
  for (const [id, scalar] of before) {
    const next = after.get(id);
    const base = baseline.get(id);
    if (!(next && base) || scalar.value === next.value) {
      continue;
    }
    const k = (next.value - scalar.value) / (x1 - x0);
    const c = scalar.value - k * x0;
    let map: ParamMap;
    if (near(k, 1)) {
      map = near(c, 0) ? { kind: "identity" } : { c, kind: "offset" };
    } else if (near(c, 0)) {
      map = { k, kind: "scale" };
    } else {
      return "structural";
    }
    bindings.push({
      authored,
      base: base.value,
      input: decibels ? "decibels" : "value",
      map,
      target: scalar.target,
    });
  }
  return bindings.length ? bindings : "unavailable";
}

/** Exact authored restoration also preserves quiet Gains below the modulation range. */
export function mapParamValue(binding: ParamBinding, value: number): number {
  if (value === binding.authored) {
    return binding.base;
  }
  const input = binding.input === "decibels" ? dbToGain(value) : value;
  switch (binding.map.kind) {
    case "identity":
      return input;
    case "scale":
      return input * binding.map.k;
    case "offset":
      return input + binding.map.c;
    default: {
      const exhaustive: never = binding.map;
      return exhaustive;
    }
  }
}
