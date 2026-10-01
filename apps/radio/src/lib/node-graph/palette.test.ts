import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { createNodeEffectConfig } from "./catalogue";
import { commitNodeGraph, createNodeStore, undoNodeGraph } from "./node-store";
import {
  addPaletteNode,
  autoConnection,
  connectPorts,
  createPaletteNode,
  dropOnNode,
  dropRefusal,
  PALETTE_TEMPLATES,
  type PaletteFrom,
  type PaletteNodeEntry,
  paletteEntries,
  resetEffect,
  rewireTargets,
  templatePatch,
} from "./palette";
import {
  AUDIO_IN_HANDLE,
  AUDIO_OUT_HANDLE,
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
} from "./templates";
import { BUS_MERGE_MESSAGE, validate } from "./validate";

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
      displayCapture: true,
      radios: [radio("c"), radio("d", { enabled: false })],
    });

    expect(
      entries
        .filter((entry) => entry.section !== "fx")
        .map((entry) => `${entry.section}:${entry.name}`)
    ).toEqual([
      "sources:Station",
      "sources:Track",
      "sources:YouTube",
      "sources:SoundCloud",
      "sources:Bandcamp",
      "sources:File",
      "sources:Audio input",
      "sources:Browser tab audio",
      "sources:Spotify",
      "sources:Mixcloud",
      "sources:Radio episodes / shows",
      "sources:Station c",
      "routing:Split",
      "routing:Stereo Split",
      "routing:Band Split",
      "routing:Merge",
      "templates:Starter",
      "templates:All my stations",
      "templates:Duck",
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
      displayCapture: true,
      from: fromSpeakers,
      radios: [radio("c")],
    });

    expect(
      entries
        .filter((entry) => entry.section !== "fx")
        .map((entry) => entry.name)
    ).toEqual([
      "Station",
      "Track",
      "YouTube",
      "SoundCloud",
      "Bandcamp",
      "File",
      "Audio input",
      "Browser tab audio",
      "Spotify",
      "Mixcloud",
      "Radio episodes / shows",
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

  test("a new Split names its chains as the canvas names its branches", () => {
    const { graph, nodeId } = addPaletteNode(patch, {
      id: "fxComposite",
      kind: "node",
      name: "Split",
      section: "routing",
      type: "fxComposite",
    });
    const node = graph.nodes.find((entry) => entry.id === nodeId);

    expect(
      node?.type === "fxComposite" && node.data.effect.type === "fxComposite"
        ? node.data.effect.chains.map((chain) => chain.name)
        : null
    ).toEqual(["Branch 1", "Branch 2"]);
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

describe("paletteEntries: audio inputs and output devices", () => {
  const devices = {
    inputs: [
      { deviceId: "mic", label: "Desk mic" },
      { deviceId: "line", label: "Line in" },
    ],
    outputs: [
      { deviceId: "default", label: "Default - Speakers" },
      { deviceId: "usb", label: "USB interface" },
      { deviceId: "hdmi", label: "Monitor" },
    ],
  };

  function names(
    entries: ReturnType<typeof paletteEntries>,
    section: string
  ): string[] {
    return entries
      .filter((entry) => entry.section === section)
      .map((entry) => entry.name);
  }

  test("Sources list Audio input and one entry per input, set to it", () => {
    const entries = paletteEntries(patch, { devices, displayCapture: true });

    expect(names(entries, "sources")).toEqual([
      "Station",
      "Track",
      "YouTube",
      "SoundCloud",
      "Bandcamp",
      "File",
      "Audio input",
      "Desk mic",
      "Line in",
      "Browser tab audio",
      "Spotify",
      "Mixcloud",
      "Radio episodes / shows",
    ]);
    expect(entries.find((entry) => entry.id === "deviceIn:line")).toMatchObject(
      { device: { deviceId: "line", label: "Line in" }, type: "deviceIn" }
    );
  });

  test("a browser that can't share its audio is offered no shared-audio source", () => {
    const entries = paletteEntries(patch, { devices, displayCapture: false });

    expect(names(entries, "sources")).toEqual([
      "Station",
      "Track",
      "YouTube",
      "SoundCloud",
      "Bandcamp",
      "File",
      "Audio input",
      "Desk mic",
      "Line in",
    ]);
    expect(entries.some((entry) => entry.id.startsWith("capture:"))).toBe(
      false
    );
  });

  test("Outputs list Speakers and one Output device per output, not the main one", () => {
    const entries = paletteEntries(
      { ...patch, edges: [], nodes: [] },
      { devices, sinkSelection: true }
    );

    expect(names(entries, "outputs")).toEqual([
      "Speakers",
      "USB interface",
      "Monitor",
    ]);
  });

  test("with no output listed yet, one Output device to set up", () => {
    const entries = paletteEntries(patch, { sinkSelection: true });

    expect(names(entries, "outputs")).toEqual(["Output device"]);
  });

  test("with only the main output listed, one Output device to set up", () => {
    const entries = paletteEntries(patch, {
      devices: {
        inputs: [],
        outputs: [{ deviceId: "default", label: "Default - Speakers" }],
      },
      sinkSelection: true,
    });

    expect(names(entries, "outputs")).toEqual(["Output device"]);
  });

  test("a browser that can't choose an output is offered no Output device", () => {
    const entries = paletteEntries(patch, { devices, sinkSelection: false });

    expect(entries.some((entry) => entry.id.startsWith("deviceOut"))).toBe(
      false
    );
  });

  test("an output that already has an Output device isn't offered again", () => {
    const added = addPaletteNode(patch, {
      device: { deviceId: "usb", label: "USB interface" },
      id: "deviceOut:usb",
      kind: "node",
      name: "USB interface",
      section: "outputs",
      type: "deviceOut",
    });

    expect(
      names(
        paletteEntries(added.graph, { devices, sinkSelection: true }),
        "outputs"
      )
    ).toEqual(["Monitor"]);
  });

  test("an Audio input comes set to its device, with only an audio out, and no cable", () => {
    const { graph, nodeId } = addPaletteNode(patch, {
      device: { deviceId: "mic", label: "Desk mic" },
      id: "deviceIn:mic",
      kind: "node",
      name: "Desk mic",
      section: "sources",
      type: "deviceIn",
    });

    const node = graph.nodes.find((entry) => entry.id === nodeId);
    expect(node).toMatchObject({
      data: {
        channelSelection: { left: 0, right: 1 },
        deviceId: "mic",
        deviceLabel: "Desk mic",
        echoCancellation: false,
        muted: false,
        volume: 1,
      },
      type: "deviceIn",
    });
    // A mic into speakers can howl: the cable is the user's to make.
    expect(graph.edges).toEqual(patch.edges);
    expect(validate(graph)).toEqual([]);
  });

  test("an Audio input can feed a cable dropped from Speakers' input", () => {
    const entries = paletteEntries(patch, { devices, from: fromSpeakers });

    expect(names(entries, "sources")).toContain("Desk mic");
  });
});

describe("templates", () => {
  test("lists Starter, All my stations, Duck and Blank in that order", () => {
    expect(
      PALETTE_TEMPLATES.map((entry) => [entry.name, entry.template])
    ).toEqual([
      ["Starter", "starter"],
      ["All my stations", "start-from-multiple"],
      ["Duck", "duck"],
      ["Blank", "blank"],
    ]);
  });

  test("each replaces the patch as one undo step", () => {
    for (const { template } of PALETTE_TEMPLATES) {
      const before = { ...patch, viewport: { x: 12, y: 34, zoom: 0.8 } };
      const store = createNodeStore(before);

      commitNodeGraph(
        (current) => templatePatch(current, template, { saved: [radio("a")] }),
        store,
        "snapshot"
      );

      expect(store.state.graph).toEqual({
        ...buildNodeGraphFromTemplate(template, { saved: [radio("a")] }),
        viewport: before.viewport,
      });
      expect(store.state.history.past).toHaveLength(1);
      expect(undoNodeGraph(store)).toBe(true);
      expect(store.state.graph).toEqual(before);
    }
  });

  test("a station already in the patch keeps its level", () => {
    const quiet = {
      ...patch,
      nodes: patch.nodes.map((node) =>
        node.id === "src-a" && node.type === "station"
          ? { ...node, data: { ...node.data, muted: true, volume: 0.3 } }
          : node
      ),
    };

    const next = templatePatch(quiet, "start-from-multiple", {
      saved: [radio("a"), radio("c")],
    });

    expect(next.nodes.find((node) => node.id === "src-a")?.data).toMatchObject({
      muted: true,
      volume: 0.3,
    });
    expect(next.nodes.find((node) => node.id === "src-c")?.data).toMatchObject({
      muted: false,
      volume: 1,
    });
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

  test("a dropped cable that would not compile leaves the new node loose", () => {
    const blank = buildNodeGraphFromTemplate("blank", {});
    const delay = (id: string) =>
      createPaletteNode("delay", id, { x: 0, y: 0 }, null, null);
    const cable = (source: string, target: string) => ({
      gain: 1,
      id: `${source}->${target}`,
      muted: false,
      source,
      sourceHandle: AUDIO_OUT_HANDLE,
      target,
      targetHandle: AUDIO_IN_HANDLE,
    });
    // Branches with no source yet: nothing to join until one comes in.
    const fanOut = {
      ...blank,
      edges: [
        cable("x", "y"),
        cable("x", "z"),
        cable("y", SPEAKERS_NODE_ID),
        cable("z", SPEAKERS_NODE_ID),
      ],
      nodes: [
        ...blank.nodes,
        ...["x", "y", "z"].flatMap((id) => delay(id) ?? []),
      ],
    };

    const { graph, nodeId } = addPaletteNode(
      fanOut,
      { ...emptyStation, radio: radio("c") },
      { from: { handle: AUDIO_IN_HANDLE, node: "x", type: "target" } }
    );

    expect(graph.nodes.some((node) => node.id === nodeId)).toBe(true);
    expect(graph.edges).toEqual(fanOut.edges);
  });
});

describe("addPaletteNode: patch budgets", () => {
  const full = buildNodeGraphFromTemplate("start-from-multiple", {
    saved: Array.from({ length: 24 }, (_, index) => radio(String(index))),
  });

  test("refuses a 25th source, with or without a dropped cable", () => {
    expect(validate(full)).toEqual([]);

    for (const options of [{}, { from: fromSpeakers }]) {
      expect(addPaletteNode(full, emptyStation, options)).toEqual({
        graph: full,
        message: "Up to 24 sources per patch",
        nodeId: null,
      });
    }
  });

  test("a Station that would take a 65th cable comes loose", () => {
    const stations = buildNodeGraphFromTemplate("start-from-multiple", {
      saved: Array.from({ length: 16 }, (_, index) => radio(String(index))),
    });
    let graph = stations;
    for (const deviceId of ["one", "two", "three"]) {
      const output = addPaletteNode(graph, {
        device: { deviceId, label: deviceId },
        id: `deviceOut:${deviceId}`,
        kind: "node",
        name: deviceId,
        section: "outputs",
        type: "deviceOut",
      });
      ({ graph } = output);
      for (const station of stations.nodes.filter(
        (node) => node.type === "station"
      )) {
        graph = {
          ...graph,
          edges: [
            ...graph.edges,
            {
              gain: 1,
              id: `${station.id}->${output.nodeId}`,
              muted: false,
              source: station.id,
              sourceHandle: AUDIO_OUT_HANDLE,
              target: output.nodeId ?? "",
              targetHandle: AUDIO_IN_HANDLE,
            },
          ],
        };
      }
    }
    expect(graph.edges).toHaveLength(64);
    expect(validate(graph)).toEqual([]);

    const { graph: added, nodeId } = addPaletteNode(graph, emptyStation);

    expect(added.nodes.some((node) => node.id === nodeId)).toBe(true);
    expect(added.edges).toEqual(graph.edges);
    expect(validate(added)).toEqual([]);
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

describe("dropRefusal", () => {
  const mix = createPaletteNode("merge", "mix", { x: 400, y: 0 });
  if (!mix) {
    throw new Error("Expected a Merge");
  }
  const merged = {
    ...patch,
    edges: [
      ...patch.edges.filter((edge) => edge.source !== "src-a"),
      { ...patch.edges[0], id: "a-mix", source: "src-a", target: "mix" },
      {
        ...patch.edges[0],
        id: "mix-out",
        source: "mix",
        target: SPEAKERS_NODE_ID,
      },
    ],
    nodes: [...patch.nodes, mix],
  } as typeof patch;
  const fromB: PaletteFrom = {
    handle: AUDIO_OUT_HANDLE,
    node: "src-b",
    type: "source",
  };

  test("a second station dropped on a Merge's body says why it was refused", () => {
    expect(validate(merged)).toEqual([]);
    expect(autoConnection(merged, fromB, "mix")).toBeNull();
    expect(dropRefusal(merged, fromB, "mix")).toBe(BUS_MERGE_MESSAGE);
  });

  test("says nothing when a port would take the cable", () => {
    const loose = { ...patch, edges: [] };
    expect(dropRefusal(loose, fromB, SPEAKERS_NODE_ID)).toBeNull();
    expect(dropRefusal(merged, fromB, "src-b")).toBeNull();
  });

  describe("key cables", () => {
    // KEXP → Compressor (keyed by Radio 4) → Gate → Speakers, plus a
    // loose FIP and a Crusher in no lane.
    const duck = buildNodeGraphFromTemplate("duck", {
      saved: [
        radio("kexp", { name: "KEXP", order: 0 }),
        radio("r4", { name: "BBC Radio 4", order: 1 }),
      ],
    });
    const fip = createPaletteNode(
      "station",
      "src-fip",
      { x: 0, y: 400 },
      radio("fip", { name: "FIP" })
    );
    const gate = createPaletteNode("gate", "gate", { x: 600, y: 0 });
    const crusher = createPaletteNode("crusher", "crusher", { x: 600, y: 200 });
    if (!(fip && gate && crusher)) {
      throw new Error("Expected a Station, a Gate and a Crusher");
    }
    const keyed = {
      ...duck,
      edges: [
        ...duck.edges.filter((edge) => edge.id !== "duck->speakers"),
        { ...patch.edges[0], id: "duck->gate", source: "duck", target: "gate" },
        {
          ...patch.edges[0],
          id: "gate->speakers",
          source: "gate",
          target: SPEAKERS_NODE_ID,
        },
      ],
      nodes: [...duck.nodes, fip, gate, crusher],
    } as typeof duck;

    test("a station dropped on a full FX in a keyed lane says One key per lane", () => {
      expect(validate(keyed)).toEqual([]);
      const fromFip: PaletteFrom = {
        handle: AUDIO_OUT_HANDLE,
        node: "src-fip",
        type: "source",
      };
      expect(autoConnection(keyed, fromFip, "gate")).toBeNull();
      expect(dropRefusal(keyed, fromFip, "gate")).toBe("One key per lane");
    });

    test("a key dropped on a node in no lane says why", () => {
      const unkeyed = {
        ...keyed,
        edges: keyed.edges.filter(
          (edge) => edge.targetHandle !== "in:sidechain:key"
        ),
      };
      const fromKey: PaletteFrom = {
        handle: "in:sidechain:key",
        node: "duck",
        type: "target",
      };
      expect(autoConnection(unkeyed, fromKey, "crusher")).toBeNull();
      expect(dropRefusal(unkeyed, fromKey, "crusher")).toBe(
        "A key must come from a station lane"
      );
      // A station would take it: the drop was fine.
      expect(dropRefusal(unkeyed, fromKey, "src-fip")).toBeNull();
    });
  });
});

describe("dropOnNode", () => {
  const fromB: PaletteFrom = {
    handle: AUDIO_OUT_HANDLE,
    node: "src-b",
    type: "source",
  };
  const comp = createPaletteNode("compressor", "comp", { x: 400, y: 0 });
  if (!comp) {
    throw new Error("Expected a Compressor");
  }
  const loose = { ...patch, nodes: [...patch.nodes, comp] } as typeof patch;

  test("a key let go on a loose Compressor's key input is refused, not rewired as audio", () => {
    expect(dropOnNode(loose, fromB, "comp", "in:sidechain:key")).toEqual({
      refuse: "A key only works on a station lane",
    });
    // On the body, the one port that fits still takes it.
    expect(dropOnNode(loose, fromB, "comp", null)).toEqual({
      connect: {
        source: "src-b",
        sourceHandle: AUDIO_OUT_HANDLE,
        target: "comp",
        targetHandle: AUDIO_IN_HANDLE,
      },
    });
  });

  test("a port that is only full gives way to the node's other ports", () => {
    const mix = createPaletteNode("merge", "mix", { x: 400, y: 0 });
    if (!mix) {
      throw new Error("Expected a Merge");
    }
    const merged = {
      ...patch,
      edges: [
        ...patch.edges.filter((edge) => edge.source !== "src-a"),
        { ...patch.edges[0], id: "a-mix", source: "src-a", target: "mix" },
        {
          ...patch.edges[0],
          id: "mix-out",
          source: "mix",
          target: SPEAKERS_NODE_ID,
        },
      ],
      nodes: [...patch.nodes, mix],
    } as typeof patch;

    expect(dropOnNode(merged, fromB, "mix", AUDIO_IN_HANDLE)).toEqual({
      refuse: BUS_MERGE_MESSAGE,
    });
  });
});

describe("dropOnNode: Replace", () => {
  const gain = createPaletteNode("gain", "gain", { x: 400, y: 0 });
  if (!gain) {
    throw new Error("Expected a Gain");
  }
  const fed = {
    ...patch,
    edges: [
      ...patch.edges,
      { ...patch.edges[0], id: "a-gain", source: "src-a", target: "gain" },
    ],
    nodes: [...patch.nodes, gain],
  } as typeof patch;
  const fromB: PaletteFrom = {
    handle: AUDIO_OUT_HANDLE,
    node: "src-b",
    type: "source",
  };
  const replace = {
    connection: {
      source: "src-b",
      sourceHandle: AUDIO_OUT_HANDLE,
      target: "gain",
      targetHandle: AUDIO_IN_HANDLE,
    },
    edge: "a-gain",
  };

  test("a full one-cable input offers to take the cable's place, on the port or the body", () => {
    for (const port of [AUDIO_IN_HANDLE, null]) {
      expect(dropOnNode(fed, fromB, "gain", port)).toEqual({
        refuse: "This input takes one cable",
        replace,
      });
    }
  });

  test("a refusal for another reason offers nothing to replace", () => {
    expect(dropOnNode(fed, fromB, "src-a", null)).toEqual({
      refuse: "A Station makes its own sound and takes no audio in",
    });
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

  test("offers only the bands a Band Split has", () => {
    const bands = createPaletteNode("frequencySplit", "bands", { x: 0, y: 0 });
    if (!bands) {
      throw new Error("Expected a Band Split");
    }

    expect(
      connectPorts({ ...patch, nodes: [...patch.nodes, bands] }, "bands")
        .map((port) => port.handle)
        .filter((handle) => handle.startsWith("out:"))
    ).toEqual(["out:audio:band-1", "out:audio:band-2", "out:audio:band-3"]);
  });
});

describe("resetEffect", () => {
  test("a Split resets to the branch names it was created with", () => {
    const effect = createNodeEffectConfig("fxComposite", "split");
    const reset = resetEffect({ ...effect, chains: [], enabled: true });

    expect(reset.enabled).toBe(true);
    expect(
      "chains" in reset ? reset.chains.map((chain) => chain.name) : null
    ).toEqual(["Branch 1", "Branch 2"]);
  });

  test("a Band Split keeps its band count and resets its crossovers", () => {
    const three = createPaletteNode("frequencySplit", "bands", { x: 0, y: 0 });
    if (three?.type !== "frequencySplit") {
      throw new Error("Expected a Band Split");
    }
    const { effect } = three.data;
    if (effect.type !== "frequencySplit") {
      throw new Error("Expected a Band Split effect");
    }
    const reset = resetEffect({
      ...effect,
      crossoverFrequencies: [400, 4000],
      enabled: false,
    });

    expect(reset).toEqual({ ...effect, enabled: false });
  });
});

describe("rewireTargets", () => {
  // KEXP → Compressor (keyed by Radio 4) → Speakers, Radio 4 → Speakers.
  const duck = buildNodeGraphFromTemplate("duck", {
    saved: [
      radio("kexp", { name: "KEXP", order: 0 }),
      radio("r4", { name: "BBC Radio 4", order: 1 }),
    ],
  });
  const reasons = (graph: typeof duck, edgeId: string) =>
    Object.fromEntries(
      rewireTargets(graph, edgeId, "target").map((entry) => [
        entry.key,
        entry.reason,
      ])
    );

  test("an audio cable's destination can move onto a free key input", () => {
    const unkeyed = {
      ...duck,
      edges: duck.edges.filter((edge) => edge.id !== "src-r4->duck"),
    };
    expect(reasons(unkeyed, "src-r4->speakers")).toMatchObject({
      "duck in:sidechain:key": null,
    });
  });

  test("a key cable's destination can move back onto a normal input", () => {
    const unrouted = {
      ...duck,
      edges: duck.edges.filter((edge) => edge.id !== "src-r4->speakers"),
    };
    expect(reasons(unrouted, "src-r4->duck")).toMatchObject({
      [`${SPEAKERS_NODE_ID} ${AUDIO_IN_HANDLE}`]: null,
    });
  });
});

describe("cable surgery entries", () => {
  const fxEntry = (type: "compressor" | "filter" | "delay") =>
    ({
      id: type,
      kind: "node",
      name: type,
      section: "fx",
      type,
    }) satisfies PaletteNodeEntry;

  test("I on a cable offers only what goes into it, then inserts it", () => {
    const entries = paletteEntries(patch, { into: "src-a->speakers" });
    const sections = new Set(entries.map((entry) => entry.section));

    expect([...sections]).toEqual(["fx", "routing"]);
    const ids = entries.map((entry) => entry.id);
    expect(ids).toContain("filter");
    // A Merge passes one cable through; a split would leave a lone branch.
    expect(ids).toContain("merge");
    expect(ids).not.toContain("fxComposite");

    const { graph, nodeId } = addPaletteNode(patch, fxEntry("delay"), {
      into: "src-a->speakers",
      position: { x: 5, y: 5 },
    });
    expect(nodeId).toStartWith("delay-");
    expect(graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(
      [`src-a->${nodeId}`, `${nodeId}->speakers`, "src-b->speakers"]
    );
    expect(validate(graph)).toEqual([]);
  });

  test("a cable after an FX refuses the station's own Filter", () => {
    const { graph: withComp, nodeId } = addPaletteNode(
      patch,
      fxEntry("compressor"),
      {
        into: "src-a->speakers",
      }
    );

    const ids = paletteEntries(withComp, { into: `${nodeId}->speakers` }).map(
      (entry) => entry.id
    );

    expect(ids).toContain("delay");
    expect(ids).not.toContain("filter");
  });

  test("Swap effect… lists every other plain effect, no splits", () => {
    const { graph: withComp, nodeId } = addPaletteNode(
      patch,
      fxEntry("compressor")
    );

    const entries = paletteEntries(withComp, { swap: nodeId ?? "" });
    const ids = entries.map((entry) => entry.id);

    expect(entries.every((entry) => entry.section === "fx")).toBe(true);
    expect(ids).toContain("delay");
    expect(ids).not.toContain("compressor");
    expect(ids).not.toContain("fxComposite");
    expect(ids).not.toContain("filter");
    expect(ids).not.toContain("werkstatt");
    expect(paletteEntries(withComp, { swap: "src-a" })).toEqual([]);
  });
});
