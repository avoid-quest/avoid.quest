import { describe, expect, test } from "bun:test";
import type { EffectType } from "@/lib/audio/dsp/effects/types";
import { createNodeEffectConfig } from "./catalogue";
import { compile } from "./compile";
import {
  commitNodeGraph,
  createNodeStore,
  redoNodeGraph,
  undoNodeGraph,
} from "./node-store";
import {
  type GraphEdge,
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "./schema";
import { parallelToSeries, seriesToParallel } from "./series-parallel";

type NodeInput = NodeGraphInput["nodes"][number];

function fx(id: string, type: EffectType, x: number): NodeInput {
  return {
    data: { effect: { ...createNodeEffectConfig(type, id), enabled: true } },
    id,
    position: { x, y: 0 },
    type,
  } as NodeInput;
}

function audio(source: string, target: string, gain = 1) {
  return {
    gain,
    id: `${source}->${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle: "in:audio:main",
  };
}

/** KEXP → Compressor → Delay → Speakers, laid out left to right. */
const series: NodeGraph = nodeGraphSchema.parse({
  edges: [
    audio("kexp", "comp", 0.5),
    audio("comp", "echo"),
    audio("echo", "speakers"),
  ],
  nodes: [
    {
      data: {
        radio: { id: "kexp", name: "KEXP", streamUrl: "https://kexp.test" },
      },
      id: "kexp",
      position: { x: 0, y: 0 },
      type: "station",
    },
    fx("comp", "compressor", 320),
    fx("echo", "delay", 1200),
    { data: {}, id: "speakers", position: { x: 1600, y: 0 }, type: "speakers" },
  ],
  version: 2,
});

const both = { edges: [], nodes: ["comp", "echo"] };

/** A generated Split's id is fresh each time; it reads as its type. */
function named(id: string): string {
  return id.startsWith("fxComposite-") ? "fxComposite" : id;
}

function wiring(graph: NodeGraph): string[] {
  return graph.edges
    .map(
      (edge) =>
        `${named(edge.source)}.${edge.sourceHandle.split(":")[2]} → ${named(edge.target)}`
    )
    .sort();
}

function splitId(graph: NodeGraph): string {
  return graph.nodes.find((node) => node.type === "fxComposite")?.id ?? "";
}

function byId(edges: readonly GraphEdge[]): GraphEdge[] {
  return [...edges].sort((left, right) => left.id.localeCompare(right.id));
}

function parallel(): NodeGraph {
  const result = seriesToParallel(series, both);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.graph;
}

describe("seriesToParallel (P)", () => {
  test("two series FX become Split → both → Merge", () => {
    const graph = parallel();

    expect(wiring(graph)).toEqual([
      "comp.main → merge",
      "echo.main → merge",
      "fxComposite.branch-1 → comp",
      "fxComposite.branch-2 → echo",
      "kexp.main → fxComposite",
      "merge.main → speakers",
    ]);
    // The cable into the pair keeps its level; the one out keeps its id.
    expect(graph.edges.find((edge) => edge.id === "kexp->comp")).toMatchObject({
      gain: 0.5,
      target: splitId(graph),
    });
    expect(
      graph.edges.find((edge) => edge.id === "echo->speakers")?.source
    ).toBe("merge");
  });

  test("the result compiles to one fxComposite with a chain per FX", () => {
    const plan = compile(parallel(), { crossOriginIsolated: false });

    expect(plan.issues).toEqual([]);
    const [split] = plan.lanes.get("kexp")?.effects ?? [];
    expect(split?.type).toBe("fxComposite");
    expect(
      split && "chains" in split
        ? split.chains.map((chain) => chain.effects.map((effect) => effect.id))
        : null
    ).toEqual([["comp"], ["echo"]]);
    expect(plan.lanes.get("kexp")?.nodes).toContain("merge");
  });

  test("works whichever FX was selected first", () => {
    const result = seriesToParallel(series, {
      edges: [],
      nodes: ["echo", "comp"],
    });

    expect(result.ok && wiring(result.graph)).toEqual(wiring(parallel()));
  });

  test("refuses FX that are not cabled one after the other", () => {
    expect(
      seriesToParallel(series, { edges: [], nodes: ["comp", "speakers"] })
    ).toEqual({
      message: "Select two FX cabled one after the other",
      ok: false,
    });
    expect(seriesToParallel(series, { edges: [], nodes: ["comp"] }).ok).toBe(
      false
    );
  });
});

describe("seriesToParallel (P): large patches", () => {
  /** The series patch with filler stations cabled to Speakers and two outputs. */
  function withCables(total: number): NodeGraph {
    const targets = ["speakers", "out-1", "out-2"];
    const fillers = Array.from(
      { length: total - series.edges.length },
      (_, index) => ({
        source: `s${Math.floor(index / targets.length)}`,
        target: targets[index % targets.length] ?? "speakers",
      })
    );
    const stations = [...new Set(fillers.map(({ source }) => source))];
    return nodeGraphSchema.parse({
      ...series,
      edges: [
        ...series.edges,
        ...fillers.map(({ source, target }) => audio(source, target)),
      ],
      nodes: [
        ...series.nodes,
        ...stations.map((id, index) => ({
          data: {
            radio: { id, name: id, streamUrl: `https://${id}.test` },
          },
          id,
          position: { x: 0, y: 200 * (index + 1) },
          type: "station",
        })),
        ...["out-1", "out-2"].map((id) => ({
          data: { deviceId: id, deviceLabel: id },
          id,
          position: { x: 1600, y: 200 },
          type: "deviceOut",
        })),
      ],
    });
  }

  test("adds three cables past the former 64-cable cap", () => {
    const result = seriesToParallel(withCables(64), both);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.graph.edges).toHaveLength(67);
    expect(
      compile(result.graph, { crossOriginIsolated: false }).issues
    ).toEqual([]);
  });
});

describe("parallelToSeries (S)", () => {
  test("restores the original series graph", () => {
    const result = parallelToSeries(parallel(), both);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.graph.nodes).toEqual(series.nodes);
    expect(byId(result.graph.edges)).toEqual(byId(series.edges));
    expect(result.selection.nodes).toEqual(["comp", "echo"]);
  });

  test("finds the region from its Split or its Merge too", () => {
    const graph = parallel();
    for (const nodes of [[splitId(graph)], ["merge"], ["echo"]]) {
      const result = parallelToSeries(graph, { edges: [], nodes });
      expect(result.ok && wiring(result.graph)).toEqual(wiring(series));
    }
  });

  test("the A → B cable rides B's branch and comes back with its id, level and mute", () => {
    const quiet = nodeGraphSchema.parse({
      ...series,
      edges: series.edges.map((edge) =>
        edge.id === "comp->echo" ? { ...edge, gain: 0.4, muted: true } : edge
      ),
    });
    const p = seriesToParallel(quiet, both);
    if (!p.ok) {
      throw new Error(p.message);
    }
    expect(
      p.graph.edges.find((edge) => edge.id === "comp->echo")
    ).toMatchObject({
      gain: 0.4,
      muted: true,
      source: splitId(p.graph),
      sourceHandle: "out:audio:branch-2",
      target: "echo",
    });

    const s = parallelToSeries(p.graph, both);
    if (!s.ok) {
      throw new Error(s.message);
    }
    expect(s.graph.nodes).toEqual(quiet.nodes);
    expect(byId(s.graph.edges)).toEqual(byId(quiet.edges));
  });

  test("refuses a Split whose branches are not one FX each", () => {
    expect(parallelToSeries(series, both).ok).toBe(false);
  });

  test("refuses two cables fanning out of one Split port", () => {
    const graph = parallel();
    const fanned = nodeGraphSchema.parse({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === "comp->echo"
          ? { ...edge, sourceHandle: "out:audio:branch-1" }
          : edge
      ),
    });

    expect(parallelToSeries(fanned, both)).toEqual({
      message:
        "Select a Split whose two branches are one FX each, joined by a Merge",
      ok: false,
    });
  });
});

describe("P after S", () => {
  test("a new Split never takes a removed one's id, so its MIDI stays dormant", () => {
    const first = parallel();
    const back = parallelToSeries(first, both);
    if (!back.ok) {
      throw new Error(back.message);
    }

    const again = seriesToParallel(back.graph, both);

    expect(again.ok && splitId(again.graph)).toStartWith("fxComposite-");
    expect(again.ok && splitId(again.graph)).not.toBe(splitId(first));
  });
});

describe("series ⇄ parallel undo", () => {
  test("P and S are each one undo step, and redo brings them back", () => {
    const store = createNodeStore(series);

    commitNodeGraph(
      (graph) => {
        const result = seriesToParallel(graph, both);
        return result.ok ? result.graph : graph;
      },
      store,
      "snapshot"
    );
    const afterP = store.state.graph;
    expect(afterP && wiring(afterP)).toEqual(wiring(parallel()));

    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(series);
    expect(redoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(afterP);

    commitNodeGraph(
      (graph) => {
        const result = parallelToSeries(graph, both);
        return result.ok ? result.graph : graph;
      },
      store,
      "snapshot"
    );
    const afterS = store.state.graph;
    expect(afterS?.nodes).toEqual(series.nodes);

    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(afterP);
    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(series);
  });
});
