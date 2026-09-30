import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import {
  addPaletteNode,
  autoConnection,
  connectPorts,
  type PaletteFrom,
  type PaletteNodeEntry,
  paletteEntries,
} from "./palette";
import {
  AUDIO_IN_HANDLE,
  AUDIO_OUT_HANDLE,
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
} from "./templates";
import { validate } from "./validate";

function radio(id: string, extra: Partial<Radio> = {}): Radio {
  return {
    enabled: true,
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
    ...extra,
  };
}

const patch = buildNodeGraphFromTemplate("start-from-multiple", {
  saved: [radio("a"), radio("b")],
});

const fromSpeakers: PaletteFrom = {
  handle: AUDIO_IN_HANDLE,
  node: SPEAKERS_NODE_ID,
  type: "target",
};

const emptyStation: PaletteNodeEntry = {
  id: "station",
  kind: "node",
  name: "Station",
  section: "sources",
  type: "station",
};

describe("paletteEntries", () => {
  test("offers Stations, saved stations and templates, not a second Speakers", () => {
    const entries = paletteEntries(patch, {
      radios: [radio("c"), radio("d", { enabled: false })],
    });

    expect(entries.map((entry) => `${entry.section}:${entry.name}`)).toEqual([
      "sources:Station",
      "sources:Station c",
      "templates:Start from Multiple",
      "templates:Blank",
    ]);
  });

  test("offers Speakers to a patch without one", () => {
    const entries = paletteEntries({ ...patch, edges: [], nodes: [] });

    expect(entries.some((entry) => entry.id === "speakers")).toBe(true);
  });

  test("a cable from an input offers only nodes that can feed it", () => {
    const entries = paletteEntries(patch, {
      from: fromSpeakers,
      radios: [radio("c")],
    });

    expect(entries.map((entry) => entry.name)).toEqual([
      "Station",
      "Station c",
    ]);
  });

  test("a cable from an output offers nothing that can't take audio", () => {
    const entries = paletteEntries(patch, {
      from: { handle: AUDIO_OUT_HANDLE, node: "src-a", type: "source" },
    });

    expect(entries).toEqual([]);
  });
});

describe("addPaletteNode", () => {
  test("a Station picked without a cable is wired to Speakers", () => {
    const { graph, nodeId } = addPaletteNode(patch, {
      ...emptyStation,
      id: "station:c",
      name: "Station c",
      radio: radio("c"),
    });

    expect(nodeId).toBe("src-c");
    expect(graph.edges.at(-1)).toMatchObject({
      source: "src-c",
      target: SPEAKERS_NODE_ID,
    });
    expect(validate(graph)).toEqual([]);
  });

  test("a cable dropped on empty space is wired into the new node", () => {
    const { graph, nodeId } = addPaletteNode(patch, emptyStation, {
      from: fromSpeakers,
      position: { x: -300, y: 400 },
    });

    const added = graph.nodes.find((node) => node.id === nodeId);
    expect(added).toMatchObject({
      data: { radio: null },
      position: { x: -300, y: 400 },
      type: "station",
    });
    expect(graph.edges.filter((edge) => edge.source === nodeId)).toEqual([
      expect.objectContaining({
        sourceHandle: AUDIO_OUT_HANDLE,
        target: SPEAKERS_NODE_ID,
        targetHandle: AUDIO_IN_HANDLE,
      }),
    ]);
  });
});

describe("autoConnection", () => {
  test("a cable dropped on a node connects its one fitting port", () => {
    const loose = { ...patch, edges: [] };

    expect(
      autoConnection(
        loose,
        { handle: AUDIO_OUT_HANDLE, node: "src-a", type: "source" },
        SPEAKERS_NODE_ID
      )
    ).toEqual({
      source: "src-a",
      sourceHandle: AUDIO_OUT_HANDLE,
      target: SPEAKERS_NODE_ID,
      targetHandle: AUDIO_IN_HANDLE,
    });
  });

  test("nothing connects when no port fits", () => {
    expect(
      autoConnection(
        patch,
        { handle: AUDIO_OUT_HANDLE, node: "src-a", type: "source" },
        "src-b"
      )
    ).toBeNull();
    // Already wired: a second cable would duplicate it.
    expect(
      autoConnection(
        patch,
        { handle: AUDIO_OUT_HANDLE, node: "src-a", type: "source" },
        SPEAKERS_NODE_ID
      )
    ).toBeNull();
  });
});

describe("connectPorts", () => {
  test("lists only the ports a new cable could reach", () => {
    const loose = {
      ...patch,
      edges: patch.edges.filter((edge) => edge.source !== "src-b"),
    };

    expect(connectPorts(loose, SPEAKERS_NODE_ID)).toEqual([
      {
        handle: AUDIO_IN_HANDLE,
        label: "Input",
        targets: [
          {
            connection: {
              source: "src-b",
              sourceHandle: AUDIO_OUT_HANDLE,
              target: SPEAKERS_NODE_ID,
              targetHandle: AUDIO_IN_HANDLE,
            },
            key: `src-b ${AUDIO_OUT_HANDLE}`,
            label: "Station b audio",
          },
        ],
      },
    ]);
    expect(connectPorts(patch, "src-a")).toEqual([]);
  });
});
