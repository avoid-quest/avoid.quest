import { type CompileEnv, compile, type EnginePlan } from "./compile";
import { isRadioSourceNode, type NodeGraph } from "./schema";
import { isLocalFileGone } from "./sources";

// Keep semantic reuse bounded; history still owns its identity-cached plans.
const recentPlans = new Map<string, EnginePlan>();
const dataIds = new WeakMap<object, number>();
let nextDataId = 0;
function dataId(data: object): number {
  let id = dataIds.get(data);
  if (id === undefined) {
    id = nextDataId;
    nextDataId += 1;
    dataIds.set(data, id);
  }
  return id;
}

/**
 * Data is immutable. Its identity conservatively invalidates every authored
 * parameter (including radio identity, which async track ownership uses).
 * Position, pinning, viewport and cable colour are editor-only. Keep node
 * and cable order: the compiler uses them to lower routes deterministically.
 */
function audioKey(graph: NodeGraph, envKey: string): string {
  return JSON.stringify([
    envKey,
    graph.version,
    graph.nodes.map((node) => [node.id, node.type, dataId(node.data)]),
    graph.edges.map(({ color: _color, ...audio }) => audio),
  ]);
}

const plans = new WeakMap<NodeGraph, Map<string, EnginePlan>>();

/** Immutable editor snapshots share their plan across playback, canvas and Rack. */
export function compiledPlan(graph: NodeGraph, env: CompileEnv): EnginePlan {
  const key = JSON.stringify([
    env.crossOriginIsolated,
    env.release,
    // Local object URLs can become playable/unavailable without an authored edit.
    graph.nodes
      .filter(isRadioSourceNode)
      .map((node) => isLocalFileGone(node.data.radio)),
  ]);
  const variants = plans.get(graph) ?? new Map<string, EnginePlan>();
  let plan = variants.get(key);
  if (!plan) {
    const semantic = audioKey(graph, key);
    plan = recentPlans.get(semantic) ?? compile(graph, env);
    recentPlans.delete(semantic);
    recentPlans.set(semantic, plan);
    if (recentPlans.size > 16) {
      const oldest = recentPlans.keys().next().value;
      if (oldest !== undefined) {
        recentPlans.delete(oldest);
      }
    }
    variants.set(key, plan);
    plans.set(graph, variants);
  }
  return plan;
}
