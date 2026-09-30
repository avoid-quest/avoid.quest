import { describe, expect, test } from "bun:test";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import {
  dropTargetOf,
  NODE_ARIA_LABELS,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";

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
    expect(nodes.map((node) => node.ariaLabel)).toEqual([
      "KEXP",
      "NTS 1",
      "Speakers",
    ]);
    expect(nodes.find((node) => node.id === "speakers")?.deletable).toBe(false);
    expect(NODE_ARIA_LABELS["node.a11yDescription.default"]).toContain(
      "C to connect"
    );
  });

  test("a touch drop is found under the finger, not where the touch began", () => {
    const port = { closest: () => null, id: "port" };
    const pane = { closest: () => null, id: "pane" };
    const seen: [number, number][] = [];
    const doc = {
      elementFromPoint: (x: number, y: number) => {
        seen.push([x, y]);
        return pane as unknown as Element;
      },
    };
    const touchEnd = {
      changedTouches: [{ clientX: 120, clientY: 340 }],
      target: port,
    } as unknown as TouchEvent;

    expect(dropTargetOf(touchEnd, undefined, doc)).toBe(
      pane as unknown as Element
    );
    expect(seen).toEqual([[120, 340]]);
  });

  test("a drop falls back to the event target when nothing is hit", () => {
    const port = { closest: () => null };
    const mouseUp = {
      clientX: 4,
      clientY: 8,
      target: port,
    } as unknown as MouseEvent;

    expect(
      dropTargetOf(mouseUp, undefined, { elementFromPoint: () => null })
    ).toBe(port as unknown as Element);
  });
});
