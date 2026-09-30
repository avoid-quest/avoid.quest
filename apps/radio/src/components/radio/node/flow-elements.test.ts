import { describe, expect, test } from "bun:test";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import { NODE_ARIA_LABELS, toFlowEdges, toFlowNodes } from "./flow-elements";

const patch = buildNodeGraphFromTemplate("start-from-multiple", {
  saved: [
    {
      enabled: true,
      id: "kexp",
      name: "KEXP",
      streamUrl: "https://radio.example/kexp.mp3",
    },
    {
      enabled: true,
      id: "nts",
      name: "NTS 1",
      streamUrl: "https://radio.example/nts.mp3",
    },
  ],
});
const selection = { edges: [], nodes: [] };

describe("flow elements", () => {
  test("cables are named by what they carry and where it goes", () => {
    const edges = toFlowEdges(patch, {
      liveLanes: new Set(["n:src-kexp"]),
      selection,
    });

    expect(edges.map((edge) => edge.ariaLabel)).toEqual([
      "KEXP audio to Speakers input",
      "NTS 1 audio to Speakers input",
    ]);
    expect(edges[0]?.domAttributes).toEqual({
      "aria-roledescription": "cable",
    });
    expect(edges.map((edge) => edge.className)).toEqual([
      "node-edge-live",
      undefined,
    ]);
  });

  test("nodes are audio modules, and the keyboard hint names C", () => {
    const nodes = toFlowNodes(patch, {
      measured: new Map(),
      positions: new Map(),
      selection,
    });

    expect(
      nodes.every(
        (node) =>
          node.domAttributes?.["aria-roledescription"] === "audio module"
      )
    ).toBe(true);
    expect(nodes.find((node) => node.id === "speakers")?.deletable).toBe(false);
    expect(NODE_ARIA_LABELS["node.a11yDescription.default"]).toContain(
      "C to connect"
    );
  });
});
