import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import LZString from "lz-string";
import type { Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackSession,
  getSettings,
  playbackSessionsCollection,
  radiosCollection,
  sessionRadiosCollection,
  settingsCollection,
} from "@/lib/collections";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import {
  loadNodeGraph,
  nodeStore,
  undoNodeGraph,
} from "@/lib/node-graph/node-store";
import {
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import {
  buildNodeGraphFromTemplate,
  buildNodeSessionFromGraph,
} from "@/lib/node-graph/templates";
import type { DatabaseExport } from "@/lib/types";
import {
  createDatabaseExport,
  importFromUrl,
  mergeImportedData,
  parseImportData,
  previewImportChanges,
  replaceImportedData,
  validateImportData,
} from "./export-import";

const SETTINGS_ID = "app-settings";

async function resetCollections() {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
  ]);
  for (const collection of [
    playbackSessionsCollection,
    radiosCollection,
    sessionRadiosCollection,
    settingsCollection,
  ] as const) {
    for (const key of Array.from(collection.state.keys())) {
      collection.delete(key as never);
    }
  }
  loadNodeGraph(null);
}

beforeEach(resetCollections);

afterEach(resetCollections);

const position = { x: 0, y: 0 };
const INVALID_PATCH = /Invalid patch/;
const NEEDS_LOOP = /Feedback needs a Loop/;
const NEWER_VERSION = /newer version/;

function stationRadio(id: string): Radio {
  return {
    id,
    name: id.toUpperCase(),
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

function saveRadio(station: Radio, order = 0) {
  radiosCollection.insert({
    ...station,
    enabled: true,
    id: String(station.id),
    order,
  });
}

type NodeInput = NodeGraphInput["nodes"][number];

function stationInput(id: string): NodeInput {
  return {
    data: { radio: stationRadio(id) },
    id: `src-${id}`,
    position,
    type: "station",
  };
}

const speakersInput: NodeInput = {
  data: { muted: false },
  id: "speakers",
  position,
  type: "speakers",
};

function cable(
  source: string,
  target: string,
  { id = `${source}->${target}`, targetHandle = "in:audio:main" } = {}
) {
  return {
    id,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle,
  };
}

/** A backup as a file holds it, with fields the app types do not allow. */
function rawBackup(fields: Record<string, unknown>): DatabaseExport {
  return {
    exportDate: "2026-09-30T00:00:00.000Z",
    radios: [],
    settings: { player: { mode: "single" } },
    version: 2,
    ...fields,
  } as DatabaseExport;
}

/** A saved station, Node mode, and a stored Start from Multiple patch. */
function seedLocalPatch(): NodeGraph {
  saveRadio(stationRadio("kexp"));
  settingsCollection.insert({
    id: SETTINGS_ID,
    player: { mode: "single", restoreStateOnLoad: true },
  });
  const graph = buildNodeGraphFromTemplate("start-from-multiple", {
    saved: [...radiosCollection.state.values()] as Radio[],
  });
  playbackSessionsCollection.insert(buildNodeSessionFromGraph(graph));
  return graph;
}

describe("validateImportData", () => {
  test("accepts version 1 exports and drops legacy player fields", () => {
    const imported = validateImportData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "single",
          playerType: "custom",
          restoreStateOnLoad: false,
          single: { transitionDuration: 3456 },
        },
      },
      version: 1,
    });

    expect(imported.version).toBe(1);
    expect(imported.settings.player).toEqual({
      mode: "single",
      restoreStateOnLoad: false,
    });
    expect("playerType" in imported.settings.player).toBe(false);
    expect("single" in imported.settings.player).toBe(false);
  });

  test.each([
    ["multiple", "node"],
    ["party", "single"],
  ])("normalises the legacy or unknown mode %s to %s", (mode, expected) => {
    const imported = validateImportData(
      rawBackup({ settings: { player: { mode } } })
    );

    expect(imported.settings.player.mode).toBe(expected as "node" | "single");
  });

  test("preserves omitted restoreStateOnLoad so merge imports can keep local value", () => {
    const imported = validateImportData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "dj",
        },
      },
      version: 1,
    });

    expect(imported.settings.player).toEqual({
      mode: "dj",
      restoreStateOnLoad: undefined,
    });
  });

  test("preserves omitted mode so merge imports can keep local value", () => {
    const imported = validateImportData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          restoreStateOnLoad: false,
        },
      },
      version: 1,
    });

    expect(imported.settings.player.mode).toBeUndefined();
    expect(imported.settings.player.restoreStateOnLoad).toBe(false);
  });
});

describe("mergeImportedData", () => {
  test("preserves metadataConfig when a legacy import omits it", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      metadataConfig: {
        kind: "airtime-live-info",
        urls: ["https://radio.example/api/live-info"],
      },
      name: "Existing",
      order: 1,
      streamUrl: "https://radio.example/original.mp3",
    });

    mergeImportedData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [
        {
          id: "legacy-radio",
          name: "Existing",
          streamUrl: "https://radio.example/replaced.mp3",
        },
      ],
      settings: {
        player: {
          mode: "single",
        },
      },
      version: 1,
    });

    expect(radiosCollection.state.get("radio-1")).toMatchObject({
      metadataConfig: {
        kind: "airtime-live-info",
        urls: ["https://radio.example/api/live-info"],
      },
      streamUrl: "https://radio.example/replaced.mp3",
    });
  });

  test("does not overwrite restoreStateOnLoad when the import omits it", async () => {
    await settingsCollection.stateWhenReady();

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "single",
        restoreStateOnLoad: false,
      },
    });

    mergeImportedData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "dj",
        },
      },
      version: 1,
    });

    expect(getSettings()?.player).toEqual({
      mode: "dj",
      restoreStateOnLoad: false,
    });
  });

  test("keeps the stored mode, normalised, when the import omits it", async () => {
    await settingsCollection.stateWhenReady();

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });

    mergeImportedData(
      validateImportData({
        exportDate: "2026-04-16T00:00:00.000Z",
        radios: [],
        settings: {
          player: {
            restoreStateOnLoad: false,
          },
        },
        version: 1,
      })
    );

    expect(getSettings()?.player).toEqual({
      mode: "node",
      restoreStateOnLoad: false,
    });
  });

  test("imports stream formats for existing and new radios", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      name: "Existing",
      order: 1,
      streamFormat: "progressive",
      streamUrl: "https://radio.example/live",
    });

    mergeImportedData({
      exportDate: "2026-07-10T00:00:00.000Z",
      radios: [
        {
          id: "imported-existing",
          name: "Existing",
          streamFormat: "hls",
          streamUrl: "https://radio.example/live",
        },
        {
          id: "imported-new",
          name: "New",
          streamFormat: "hls",
          streamUrl: "https://radio.example/new",
        },
      ],
      settings: { player: { mode: "single" } },
      version: 2,
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
    expect(
      Array.from(radiosCollection.state.values()).find(
        (radio) => radio.name === "New"
      )?.streamFormat
    ).toBe("hls");
  });

  test("keeps an existing stream format when a legacy import omits it", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      name: "Existing",
      order: 1,
      streamFormat: "hls",
      streamUrl: "https://radio.example/original",
    });

    mergeImportedData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [
        {
          id: "legacy-radio",
          name: "Existing",
          streamUrl: "https://radio.example/replaced",
        },
      ],
      settings: { player: { mode: "single" } },
      version: 1,
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
  });
});

describe("stream format imports", () => {
  test("restores stream formats when replacing radios", async () => {
    await radiosCollection.stateWhenReady();

    replaceImportedData({
      exportDate: "2026-07-10T00:00:00.000Z",
      radios: [
        {
          id: "radio-1",
          name: "HLS Radio",
          streamFormat: "hls",
          streamUrl: "https://radio.example/live",
        },
      ],
      settings: { player: { mode: "single" } },
      version: 2,
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
  });

  test("previews a stream-format-only update", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      name: "Existing",
      order: 1,
      streamFormat: "progressive",
      streamUrl: "https://radio.example/live",
    });

    expect(
      previewImportChanges({
        exportDate: "2026-07-10T00:00:00.000Z",
        radios: [
          {
            id: "imported-radio",
            name: "Existing",
            streamFormat: "hls",
            streamUrl: "https://radio.example/live",
          },
        ],
        settings: { player: { mode: "single" } },
        version: 2,
      })
    ).toMatchObject({ unchangedRadios: 0, updatedRadios: 1 });
  });
});

describe("Node patch backups", () => {
  const multipleSession = {
    activeChannelId: null,
    channels: [
      {
        ...createDefaultChannel(
          getMultipleChannelId(stationRadio("nts")),
          "multiple",
          1
        ),
        muted: true,
        radio: stationRadio("nts"),
        volume: 0.4,
      },
      {
        ...createDefaultChannel(
          getMultipleChannelId(stationRadio("kexp")),
          "multiple",
          0
        ),
        radio: stationRadio("kexp"),
        volume: 0.8,
      },
      // Neither in the backup nor saved here.
      {
        ...createDefaultChannel(
          getMultipleChannelId(stationRadio("gone")),
          "multiple",
          2
        ),
        radio: stationRadio("gone"),
      },
    ],
    id: "multiple",
    masterVolume: 0.5,
  };

  test.each([
    ["merge", mergeImportedData],
    ["replace", replaceImportedData],
  ])(
    "%s imports a Multiple backup as Node with an equivalent patch",
    (_label, apply) => {
      settingsCollection.insert({
        id: SETTINGS_ID,
        player: { mode: "single", restoreStateOnLoad: true },
      });

      apply(
        validateImportData(
          rawBackup({
            radios: [stationRadio("kexp"), stationRadio("nts")],
            sessions: { multiple: multipleSession },
            settings: { player: { mode: "multiple" } },
          })
        )
      );

      expect(getSettings()?.player.mode).toBe("node");
      const session = getPlaybackSession("node");
      const stations = session?.graph?.nodes.flatMap((node) =>
        node.type === "station" ? [node] : []
      );
      // Multiple's order, volumes and mutes, each Station wired to Speakers.
      expect(
        stations?.map((node) => [node.id, node.data.volume, node.data.muted])
      ).toEqual([
        ["src-kexp", 0.8, false],
        ["src-nts", 0.4, true],
      ]);
      expect(
        session?.graph?.edges.map((edge) => `${edge.source}->${edge.target}`)
      ).toEqual(["src-kexp->speakers", "src-nts->speakers"]);
      expect(session?.channels.map((channel) => channel.id)).toEqual([
        "n:src-kexp",
        "n:src-nts",
      ]);
      expect(playbackSessionsCollection.state.has("multiple")).toBe(false);
    }
  );

  test("an exported patch round-trips, FX and viewport included", () => {
    saveRadio(stationRadio("kexp"), 0);
    saveRadio(stationRadio("nts"), 1);
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "node", restoreStateOnLoad: true },
    });
    const authored = nodeGraphSchema.parse({
      edges: [
        cable("src-kexp", "room"),
        cable("room", "speakers"),
        { ...cable("src-nts", "speakers"), gain: 0.5, muted: true },
      ],
      nodes: [
        stationInput("kexp"),
        stationInput("nts"),
        {
          data: { effect: createNodeEffectConfig("cheapReverb", "room") },
          id: "room",
          position: { x: 240, y: 0 },
          type: "cheapReverb",
        },
        speakersInput,
      ],
      version: 1,
      viewport: { x: 12, y: -8, zoom: 0.75 },
    } satisfies NodeGraphInput);
    playbackSessionsCollection.insert(buildNodeSessionFromGraph(authored));
    const graph = getPlaybackSession("node")?.graph;
    const json = JSON.stringify(createDatabaseExport());

    // The patch moves on after the backup.
    playbackSessionsCollection.delete("node");
    playbackSessionsCollection.insert(
      buildNodeSessionFromGraph(buildNodeGraphFromTemplate("blank"))
    );
    replaceImportedData(parseImportData(json));

    expect(graph?.nodes.map((node) => node.id)).toContain("room");
    expect(getPlaybackSession("node")?.graph).toEqual(graph);
    expect(
      getPlaybackSession("node")?.channels.map((channel) => [
        channel.id,
        channel.effects.map((effect) => effect.id),
      ])
    ).toEqual([
      ["n:src-kexp", ["room"]],
      ["n:src-nts", []],
    ]);
  });

  test("a patch over the device budgets round-trips", () => {
    // Start from Multiple and the search bar add Stations past the budget;
    // the compiler reports the extra ones, so an import must not refuse them.
    const radios = Array.from({ length: 26 }, (_, index) =>
      stationRadio(`station-${index}`)
    );
    radios.forEach((radio, index) => {
      saveRadio(radio, index);
    });
    const graph = buildNodeGraphFromTemplate("start-from-multiple", {
      saved: [...radiosCollection.state.values()] as Radio[],
    });
    expect(graph.nodes.filter((node) => node.type === "station")).toHaveLength(
      26
    );
    playbackSessionsCollection.insert(buildNodeSessionFromGraph(graph));
    const json = JSON.stringify(createDatabaseExport());
    playbackSessionsCollection.delete("node");
    playbackSessionsCollection.insert(
      buildNodeSessionFromGraph(buildNodeGraphFromTemplate("blank"))
    );

    replaceImportedData(parseImportData(json));

    expect(getPlaybackSession("node")?.graph).toEqual(graph);
  });

  test("a share link never carries a patch", () => {
    const local = seedLocalPatch();
    const imported = buildNodeGraphFromTemplate("blank");
    const payload = LZString.compressToBase64(
      JSON.stringify(rawBackup({ sessions: { node: { graph: imported } } }))
    );

    const data = importFromUrl(
      `https://radio.example/import#data=${encodeURIComponent(payload)}`
    );
    mergeImportedData(data);

    expect(data.sessions).toBeUndefined();
    expect(getPlaybackSession("node")?.graph).toEqual(local);
  });

  test("a share link with an invalid patch still imports its stations", () => {
    const payload = LZString.compressToBase64(
      JSON.stringify(
        rawBackup({
          radios: [stationRadio("kexp")],
          sessions: { node: { graph: { version: 1 } } },
        })
      )
    );

    const data = importFromUrl(
      `https://radio.example/import#data=${encodeURIComponent(payload)}`
    );

    expect(data.radios.map((radio) => radio.name)).toEqual(["KEXP"]);
  });

  test("an import replaces the open patch as one undo step", () => {
    const local = seedLocalPatch();
    loadNodeGraph(local);
    const imported = buildNodeGraphFromTemplate("blank");

    mergeImportedData(rawBackup({ sessions: { node: { graph: imported } } }));

    expect(nodeStore.state.graph).toEqual(imported);
    expect(getPlaybackSession("node")?.graph).toEqual(imported);
    expect(undoNodeGraph()).toBe(true);
    expect(nodeStore.state.graph).toBe(local);
  });

  const invalidGraphs: [string, unknown, RegExp][] = [
    [
      "a cable into a port of an unknown kind",
      {
        edges: [cable("src-a", "speakers", { targetHandle: "in:video:main" })],
        nodes: [stationInput("a"), speakersInput],
        version: 1,
      },
      INVALID_PATCH,
    ],
    [
      "a delay-free cycle",
      {
        edges: [
          cable("src-a", "mix"),
          cable("mix", "echo"),
          cable("echo", "speakers"),
          cable("echo", "mix", { id: "back" }),
        ],
        nodes: [
          stationInput("a"),
          { data: {}, id: "mix", position, type: "merge" },
          {
            data: { effect: createNodeEffectConfig("delay", "echo") },
            id: "echo",
            position,
            type: "delay",
          },
          speakersInput,
        ],
        version: 1,
      },
      NEEDS_LOOP,
    ],
    [
      "a cable to a missing node",
      {
        edges: [cable("src-a", "nowhere")],
        nodes: [stationInput("a"), speakersInput],
        version: 1,
      },
      INVALID_PATCH,
    ],
    [
      "a patch from a newer version",
      { edges: [], nodes: [speakersInput], version: 2 },
      NEWER_VERSION,
    ],
  ];

  test.each(invalidGraphs)(
    "refuses %s and changes nothing",
    (_label, graph, message) => {
      const local = seedLocalPatch();
      const backup = rawBackup({
        radios: [stationRadio("new")],
        sessions: { node: { graph } },
        settings: { player: { mode: "dj", restoreStateOnLoad: false } },
      });

      expect(() => validateImportData(backup)).toThrow(message);
      expect(() => mergeImportedData(backup)).toThrow(message);
      expect(() => replaceImportedData(backup)).toThrow(message);

      expect([...radiosCollection.state.keys()]).toEqual(["kexp"]);
      expect(getSettings()?.player).toEqual({
        mode: "single",
        restoreStateOnLoad: true,
      });
      expect(getPlaybackSession("node")?.graph).toEqual(local);
    }
  );

  test.each([
    ["sessions that are not an object", { sessions: "node" }],
    ["a Multiple session without channels", { sessions: { multiple: {} } }],
  ])("refuses %s", (_label, fields) => {
    expect(() => validateImportData(rawBackup(fields))).toThrow();
  });

  test("a backup without a patch leaves the stored one alone", () => {
    const local = seedLocalPatch();

    mergeImportedData(rawBackup({ settings: { player: { mode: "node" } } }));

    expect(getPlaybackSession("node")?.graph).toEqual(local);
    expect(getSettings()?.player.mode).toBe("node");
  });
});
