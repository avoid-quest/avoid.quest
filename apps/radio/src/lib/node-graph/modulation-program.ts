import type { ControlLink, ModulationProgram } from "./modulation-dsp";
import { controlDepth } from "./modulation-parameters";
import { isModulationNode, type NodeGraph } from "./schema";
import { analyseGraph } from "./validate";
export function modulationProgram(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  analysis = analyseGraph(graph)
): ModulationProgram {
  const { wired, issues } = analysis;
  const refusedNodes = new Set(
    issues.filter((issue) => issue.target === "node").map((issue) => issue.id)
  );
  const refusedEdges = new Set(
    issues.filter((issue) => issue.target === "edge").map((issue) => issue.id)
  );
  const nodes = graph.nodes
    .filter(isModulationNode)
    .filter((node) => !refusedNodes.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const links: ControlLink[] = [];
  for (const { edge, to } of wired) {
    if (edge.muted || refusedEdges.has(edge.id) || !ids.has(edge.target)) {
      continue;
    }
    if (to.kind === "control" && ids.has(edge.source)) {
      links.push({
        depth: controlDepth(edge),
        source: edge.source,
        target: edge.target,
      });
    }
  }
  return {
    followers: nodes
      .filter((node) => node.type === "follower")
      .map((node) => node.id),
    links,
    nodes,
  };
}
