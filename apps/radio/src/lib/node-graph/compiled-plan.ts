import { type CompileEnv, compile, type EnginePlan } from "./compile";
import type { NodeGraph } from "./schema";

const plans = new WeakMap<NodeGraph, Map<string, EnginePlan>>();

/** Immutable editor snapshots share their plan across playback, canvas and Rack. */
export function compiledPlan(graph: NodeGraph, env: CompileEnv): EnginePlan {
  const key = JSON.stringify([
    env.crossOriginIsolated,
    env.profile,
    env.release,
    env.playing,
  ]);
  const variants = plans.get(graph) ?? new Map<string, EnginePlan>();
  let plan = variants.get(key);
  if (!plan) {
    plan = compile(graph, env);
    variants.set(key, plan);
    plans.set(graph, variants);
  }
  return plan;
}
