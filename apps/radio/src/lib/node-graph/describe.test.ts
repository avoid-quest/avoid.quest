import { describe, expect, test } from "bun:test";
import { edgeLabel, portName } from "./describe";
import type { NodeGraph } from "./schema";
import { buildNodeGraphFromTemplate } from "./templates";

const patch = buildNodeGraphFromTemplate("start-from-multiple", {
  saved: [
    {
      enabled: true,
      id: "kexp",
      name: "KEXP",
      streamUrl: "https://radio.example/kexp.mp3",
    },
  ],
});

describe("edgeLabel", () => {
  test("names a cable by its station and the port it reaches", () => {
    const [edge] = patch.edges;
    if (!edge) {
      throw new Error("expected a cable");
    }

    expect(edgeLabel(patch, edge)).toBe("KEXP audio to Speakers input");
  });

  test("names a keyed input and an empty Station", () => {
    const graph: Pick<NodeGraph, "nodes"> = {
      nodes: [
        {
          data: { muted: false, radio: null, volume: 1 },
          id: "slot",
          position: { x: 0, y: 0 },
          type: "station",
        },
        {
          data: {},
          id: "comp",
          position: { x: 0, y: 0 },
          type: "compressor",
        } as unknown as NodeGraph["nodes"][number],
      ],
    };

    expect(
      edgeLabel(graph, {
        source: "slot",
        sourceHandle: "out:audio:main",
        target: "comp",
        targetHandle: "in:sidechain:key",
      })
    ).toBe("Empty Station audio to Compressor key input");
  });
});

describe("portName", () => {
  test("reads as a port on its own node", () => {
    expect(
      portName({
        direction: "out",
        id: "main",
        kind: "audio",
        label: "Out",
        max: 1,
      })
    ).toBe("Audio out");
  });
});
