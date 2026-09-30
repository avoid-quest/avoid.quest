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

    expect(
      entries
        .filter((entry) => entry.section !== "fx")
        .map((entry) => `${entry.section}:${entry.name}`)
    ).toEqual([
      "sources:Station",
      "sources:Station c",
      "routing:Split",
      "routing:Stereo Split",
      "routing:Band Split",
      "routing:Merge",
      "templates:Start from Multiple",
      "templates:Blank",
    ]);
  });

  test("offers the native strip, then every shipped effect but Werkstatt and the splits", () => {
    const fx = paletteEntries(patch).filter((entry) => entry.section === "fx");

    expect(fx.map((entry) => entry.id)).toEqual([
      "filter",
      "pan",
      "gain",
      "revamp",
      "autotune",
      "compressor",
      "crusher",
      "plateReverb",
      "delay",
      "distortion",
      "fold",
      "cheapReverb",
      "gate",
      "limiter",
      "maximizer",
      "pitchShifter",
      "stereoTool",
      "tidal",
      "neuralAmp",
      "vocoder",
      "waveshaper",
    ]);
    expect(fx.map((entry) => entry.name).slice(0, 4)).toEqual([
      "Filter",
      "Pan",
      "Gain",
      "7-Band EQ",
    ]);
  });

  test("lists a station saved from the session once", () => {
    const entries = paletteEntries(patch, { radios: [radio("c"), radio("c")] });

    expect(entries.filter((entry) => entry.id === "station:c")).toHaveLength(1);
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

    expect(
      entries
        .filter((entry) => entry.section !== "fx")
        .map((entry) => entry.name)
    ).toEqual([
      "Station",
      "Station c",
      "Split",
      "Stereo Split",
      "Band Split",
      "Merge",
    ]);
    expect(entries.some((entry) => entry.id === "compressor")).toBe(true);
    expect(entries.some((entry) => entry.section === "templates")).toBe(false);
  });

  test("a cable from an output offers only what takes audio: FX and routing", () => {
    const entries = paletteEntries(patch, {
      from: { handle: AUDIO_OUT_HANDLE, node: "src-a", type: "source" },
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every(
        (entry) => entry.section === "fx" || entry.section === "routing"
      )
    ).toBe(true);
  });

  test("a new Band Split starts with three bands", () => {
    const { graph, nodeId } = addPaletteNode(patch, {
      id: "frequencySplit",
      kind: "node",
      name: "Band Split",
      section: "routing",
      type: "frequencySplit",
    });
    const node = graph.nodes.find((entry) => entry.id === nodeId);

    expect(node?.type).toBe("frequencySplit");
    expect(
      node?.type === "frequencySplit" &&
        node.data.effect.type === "frequencySplit"
        ? node.data.effect.crossoverFrequencies
        : null
    ).toEqual([250, 2500]);
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

    expect(nodeId).toStartWith("station-");
    expect(graph.edges.at(-1)).toMatchObject({
      source: nodeId,
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

describe("addPaletteNode FX", () => {
  test("an effect comes on, with the node id as its effect id", () => {
    const { graph, nodeId } = addPaletteNode(
      patch,
      {
        id: "compressor",
        kind: "node",
        name: "Compressor",
        section: "fx",
        type: "compressor",
      },
      { position: { x: 240, y: 0 } }
    );

    expect(nodeId).toStartWith("compressor-");
    expect(graph.nodes.find((node) => node.id === nodeId)).toMatchObject({
      data: { effect: { enabled: true, id: nodeId, type: "compressor" } },
      position: { x: 240, y: 0 },
      type: "compressor",
    });
    // Unwired until it is cabled in.
    expect(graph.edges).toEqual(patch.edges);
  });

  test("a native strip node takes its defaults, wired into a dropped cable", () => {
    const { graph, nodeId } = addPaletteNode(
      patch,
      { id: "pan", kind: "node", name: "Pan", section: "fx", type: "pan" },
      { from: fromSpeakers }
    );

    expect(graph.nodes.find((node) => node.id === nodeId)).toMatchObject({
      data: { pan: 0 },
      type: "pan",
    });
    expect(graph.edges.at(-1)).toMatchObject({
      source: nodeId,
      target: SPEAKERS_NODE_ID,
    });
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
