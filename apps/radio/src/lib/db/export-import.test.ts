import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import LZString from "lz-string";
import { toast } from "sonner";
import { AudioManager, type Radio } from "@/lib/audio";
import {
  createLocalNamModelId,
  deleteNamModel,
  getCachedNamModel,
  getNamModel,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";
import {
  createDefaultChannel,
  getPlaybackSession,
  getSettings,
  type PlaybackSessionId,
  playbackSessionsCollection,
  radiosCollection,
  sessionRadiosCollection,
  settingsCollection,
} from "@/lib/collections";
import {
  LEGACY_MULTIPLE_SESSION_ID,
  writeLegacyRecord,
} from "@/lib/collections/migrations/legacy-records";
import { modeLifecycleRequests } from "@/lib/mode-lifecycle-requests";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import {
  commitNodeGraph,
  loadNodeGraph,
  loadNodeGraphMigration,
  nodeStore,
  undoNodeGraph,
} from "@/lib/node-graph/node-store";
import {
  migrateNodeGraph,
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import { buildNodeSessionFromGraph } from "@/lib/node-graph/template-sessions";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
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
const NEEDS_LOOP = /That would feed the sound back into itself/;
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

/** Reports `mode` as the one the mode lifecycle runs. */
function playingMode(mode: PlaybackSessionId) {
  return spyOn(modeLifecycleRequests, "getTransitionSnapshot").mockReturnValue({
    currentMode: mode,
    error: null,
    phase: "active",
    requestedMode: null,
  });
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
  test.each([
    ["a null station", { radios: [null] }],
    [
      "an invalid stream URL",
      { radios: [{ ...stationRadio("bad"), streamUrl: null }] },
    ],
    [
      "an invalid stream format",
      { radios: [{ ...stationRadio("bad"), streamFormat: "mp4" }] },
    ],
    [
      "invalid platform metadata",
      {
        radios: [
          { ...stationRadio("bad"), platformMetadata: { platform: "youtube" } },
        ],
      },
    ],
    [
      "invalid metadata config",
      {
        radios: [
          {
            ...stationRadio("bad"),
            metadataConfig: { kind: "airtime-live-info", urls: null },
          },
        ],
      },
    ],
    [
      "invalid station preferences",
      { radios: [{ ...stationRadio("bad"), enabled: "yes", order: "first" }] },
    ],
    [
      "an invalid restore preference",
      { settings: { player: { restoreStateOnLoad: "yes" } } },
    ],
    ["an invalid player object", { settings: { player: [] } }],
    ["an invalid settings object", { settings: [] }],
  ])("refuses %s before preview", (_label, fields) => {
    expect(() => validateImportData(rawBackup(fields))).toThrow();
  });

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

  test("accepts version 3 backups and refuses newer ones", () => {
    expect(validateImportData({ ...rawBackup({}), version: 3 }).version).toBe(
      3
    );
    expect(() => validateImportData({ ...rawBackup({}), version: 4 })).toThrow(
      NEWER_VERSION
    );
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

describe("failed imports", () => {
  // TanStack's $synced/$origin bookkeeping can settle during a rollback;
  // compare the saved document fields, which are the user's data.
  function recordData(record: object | undefined) {
    return record
      ? Object.fromEntries(
          Object.entries(record).filter(([key]) => !key.startsWith("$"))
        )
      : undefined;
  }

  const importers = [
    ["merge", mergeImportedData],
    ["replace", replaceImportedData],
  ] as const;

  async function seedAuthoredPatch() {
    const local = seedLocalPatch();
    const modelId = createLocalNamModelId();
    await saveNamModel(modelId, '{"saved":true}');
    const effect = createNodeEffectConfig("neuralAmp", "amp");
    effect.modelId = modelId;
    local.nodes.push({
      data: { effect },
      id: "amp",
      position,
      type: "neuralAmp",
    });
    playbackSessionsCollection.update("node", (draft) => {
      draft.graph = local;
      draft.masterVolume = 0.2;
    });
    loadNodeGraph(local);
    commitNodeGraph(
      (graph) => ({ ...graph, viewport: { x: 12, y: 24, zoom: 1 } }),
      nodeStore,
      "snapshot"
    );
    await Promise.resolve();
    await Promise.resolve();
    return modelId;
  }

  test.each(importers)(
    "%s rejects invalid stations and settings without changing state or collecting models",
    async (_label, apply) => {
      const modelId = await seedAuthoredPatch();
      const library = [...radiosCollection.state.values()].map(recordData);
      const settings = recordData(getSettings());
      const session = recordData(getPlaybackSession("node"));
      const editor = nodeStore.state;
      const errors = spyOn(console, "error").mockImplementation(
        () => undefined
      );
      try {
        for (const fields of [
          { radios: [{ ...stationRadio("bad"), streamUrl: null }] },
          { settings: { player: { mode: "dj", restoreStateOnLoad: "yes" } } },
        ]) {
          const backup = rawBackup({
            radios: [
              {
                ...stationRadio("kexp"),
                streamUrl: "https://radio.example/changed",
              },
              stationRadio("new"),
            ],
            sessions: { node: { graph: buildNodeGraphFromTemplate("blank") } },
            settings: { player: { mode: "dj", restoreStateOnLoad: false } },
            ...fields,
          });
          // Keep a valid station before the invalid one to catch partial merges.
          if (fields.radios) {
            backup.radios.unshift(stationRadio("new"));
          }
          expect(() => validateImportData(backup)).toThrow();
          expect(() => apply(backup)).toThrow();
          expect([...radiosCollection.state.values()].map(recordData)).toEqual(
            library
          );
          expect(recordData(getSettings())).toEqual(settings);
          expect(recordData(getPlaybackSession("node"))).toEqual(session);
          expect(nodeStore.state).toBe(editor);
          expect(getCachedNamModel(modelId)).toBe('{"saved":true}');
        }
        await Promise.resolve();
        await Promise.resolve();
        expect(getCachedNamModel(modelId)).toBe('{"saved":true}');
        expect(undoNodeGraph()).toBe(true);
      } finally {
        errors.mockRestore();
      }
    }
  );

  test("replace rejects duplicate station IDs before deleting local data", () => {
    seedLocalPatch();
    const library = [...radiosCollection.state.values()].map(recordData);
    const session = recordData(getPlaybackSession("node"));
    const settings = recordData(getSettings());
    const backup = rawBackup({
      radios: [stationRadio("new"), { ...stationRadio("other"), id: "new" }],
      sessions: { node: { graph: buildNodeGraphFromTemplate("blank") } },
      settings: { player: { mode: "dj" } },
    });
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => replaceImportedData(backup)).toThrow("Duplicate radio IDs");
      expect([...radiosCollection.state.values()].map(recordData)).toEqual(
        library
      );
      expect(recordData(getPlaybackSession("node"))).toEqual(session);
      expect(recordData(getSettings())).toEqual(settings);
    } finally {
      errors.mockRestore();
    }
  });

  test.each(importers)(
    "%s rolls back an application failure before changing the patch or history",
    async (_label, apply) => {
      const modelId = await seedAuthoredPatch();
      const library = [...radiosCollection.state.values()].map(recordData);
      const settings = recordData(getSettings());
      const session = recordData(getPlaybackSession("node"));
      const editor = nodeStore.state;
      const originalInsert = radiosCollection.insert;
      const insert = spyOn(radiosCollection, "insert")
        .mockImplementationOnce(originalInsert)
        .mockImplementationOnce(() => {
          throw new Error("insert failed");
        });
      const errors = spyOn(console, "error").mockImplementation(
        () => undefined
      );
      try {
        expect(() =>
          apply(
            rawBackup({
              radios: [stationRadio("new"), stationRadio("other")],
              sessions: {
                node: { graph: buildNodeGraphFromTemplate("blank") },
              },
              settings: { player: { mode: "dj" } },
            })
          )
        ).toThrow("insert failed");
        await Promise.resolve();
        await Promise.resolve();
        expect([...radiosCollection.state.values()].map(recordData)).toEqual(
          library
        );
        expect(recordData(getSettings())).toEqual(settings);
        expect(recordData(getPlaybackSession("node"))).toEqual(session);
        expect(nodeStore.state).toBe(editor);
        expect(getCachedNamModel(modelId)).toBe('{"saved":true}');
      } finally {
        insert.mockRestore();
        errors.mockRestore();
      }
    }
  );

  test("a historic replacement with numeric and omitted station IDs imports successfully", () => {
    seedLocalPatch();
    replaceImportedData(
      validateImportData(
        rawBackup({
          radios: [
            { ...stationRadio("numeric"), id: 42 },
            { name: "No ID", streamUrl: "https://radio.example/no-id" },
          ],
          settings: {
            player: {
              mode: "multiple",
              playerType: "custom",
              restoreStateOnLoad: false,
            },
          },
          version: 1,
        })
      )
    );
    expect(
      [...radiosCollection.state.values()].map((radio) => radio.name)
    ).toEqual(["NUMERIC", "No ID"]);
    expect(radiosCollection.state.get("42")?.enabled).toBe(true);
    expect(getSettings()?.player).toEqual({
      mode: "node",
      restoreStateOnLoad: false,
    });
  });

  for (const collection of [
    radiosCollection,
    settingsCollection,
    playbackSessionsCollection,
  ]) {
    test.each(importers)(
      `%s restores state when ${collection.id} persistence fails`,
      async (_label, apply) => {
        const modelId = await seedAuthoredPatch();
        const library = [...radiosCollection.state.values()].map(recordData);
        const settings = recordData(getSettings());
        const session = recordData(getPlaybackSession("node"));
        const editor = nodeStore.state;
        const originalAccept = collection.utils.acceptMutations;
        const accept = spyOn(
          collection.utils,
          "acceptMutations"
        ).mockImplementationOnce((pending) => {
          originalAccept(pending);
          throw new Error("persistence failed");
        });
        const errors = spyOn(console, "error").mockImplementation(
          () => undefined
        );
        const success = spyOn(toast, "success");
        try {
          expect(() =>
            apply(
              rawBackup({
                radios: [stationRadio("new")],
                sessions: {
                  node: { graph: buildNodeGraphFromTemplate("blank") },
                },
                settings: { player: { mode: "dj", restoreStateOnLoad: false } },
              })
            )
          ).toThrow("persistence failed");
          await Promise.resolve();
          await Promise.resolve();
          expect([...radiosCollection.state.values()].map(recordData)).toEqual(
            library
          );
          expect(recordData(getSettings())).toEqual(settings);
          expect(recordData(getPlaybackSession("node"))).toEqual(session);
          expect(nodeStore.state).toBe(editor);
          expect(getCachedNamModel(modelId)).toBe('{"saved":true}');
          expect(success).not.toHaveBeenCalled();
        } finally {
          accept.mockRestore();
          errors.mockRestore();
          success.mockRestore();
        }
      }
    );
  }
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

    // A mode Node retired, as a release before Node stored it.
    writeLegacyRecord(settingsCollection, {
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

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
  /** A channel as Multiple stored it, before Node retired its role. */
  const multipleChannel = (id: string, order: number) => ({
    ...createDefaultChannel(`multi:${id}`, "node", order),
    role: "multiple",
  });
  const multipleSession = {
    activeChannelId: null,
    channels: [
      {
        ...multipleChannel("nts", 1),
        muted: true,
        radio: stationRadio("nts"),
        volume: 0.4,
      },
      {
        ...multipleChannel("kexp", 0),
        radio: stationRadio("kexp"),
        volume: 0.8,
      },
      // Neither in the backup nor saved here.
      {
        ...multipleChannel("gone", 2),
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
    "%s restores the authored master level, including mute",
    (_label, apply) => {
      seedLocalPatch();
      for (const masterVolume of [0, 0.42, 1]) {
        apply(
          rawBackup({
            sessions: {
              node: {
                graph: buildNodeGraphFromTemplate("blank"),
                masterVolume,
              },
            },
          })
        );
        expect(getPlaybackSession("node")?.masterVolume).toBe(masterVolume);
      }
    }
  );

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
      expect(
        playbackSessionsCollection.state.has(LEGACY_MULTIPLE_SESSION_ID)
      ).toBe(false);
      expect(session?.masterVolume).toBe(0.5);
    }
  );

  test("an exported patch round-trips, FX and viewport included", async () => {
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
      version: 2,
      viewport: { x: 12, y: -8, zoom: 0.75 },
    } satisfies NodeGraphInput);
    playbackSessionsCollection.insert(
      buildNodeSessionFromGraph(authored, 0.23)
    );
    const graph = getPlaybackSession("node")?.graph;
    const json = JSON.stringify(await createDatabaseExport());

    // The patch moves on after the backup.
    playbackSessionsCollection.delete("node");
    playbackSessionsCollection.insert(
      buildNodeSessionFromGraph(buildNodeGraphFromTemplate("blank"))
    );
    replaceImportedData(parseImportData(json));

    expect(graph?.nodes.map((node) => node.id)).toContain("room");
    expect(getPlaybackSession("node")?.graph).toEqual(graph);
    expect(getPlaybackSession("node")?.masterVolume).toBe(0.23);
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

  test("a v1 patch imports as v2, with a default strip on every source", () => {
    seedLocalPatch();
    const v1 = {
      edges: [cable("src-kexp", "speakers")],
      nodes: [
        { ...stationInput("kexp"), data: { radio: stationRadio("kexp") } },
        speakersInput,
      ],
      version: 1,
    };

    replaceImportedData(rawBackup({ sessions: { node: { graph: v1 } } }));

    const graph = getPlaybackSession("node")?.graph;
    expect(graph?.version).toBe(2);
    expect(
      graph?.nodes.find((node) => node.id === "src-kexp")?.data
    ).toMatchObject({ strip: { pan: 0, solo: false, trimDb: 0 } });
  });

  test("a patch over the device budgets round-trips", async () => {
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
    const json = JSON.stringify(await createDatabaseExport());
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
          namModels: { invalid: "invalid model" },
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

  test("a merge points imported Stations at the records it keeps", () => {
    // Renamed here since the backup, so the backup's KEXP merges as new.
    saveRadio({ ...stationRadio("kexp"), name: "KEXP at home" });
    // Saved here under another id; the merge matches it by name.
    saveRadio({ ...stationRadio("nts-local"), name: "NTS" }, 1);
    const nts = { ...stationRadio("nts"), name: "NTS" };
    const graph = nodeGraphSchema.parse({
      edges: [cable("src-kexp", "speakers"), cable("src-nts", "speakers")],
      nodes: [
        stationInput("kexp"),
        { data: { radio: nts }, id: "src-nts", position, type: "station" },
        speakersInput,
      ],
      version: 2,
    });

    mergeImportedData(
      rawBackup({
        radios: [stationRadio("kexp"), nts],
        sessions: { node: { graph } },
      })
    );

    const inserted = [...radiosCollection.state.values()].find(
      (radio) => radio.name === "KEXP"
    );
    if (!inserted) {
      throw new Error("Expected the backup's KEXP to merge as new");
    }
    expect(inserted.id).not.toBe("kexp");
    const stationIds = getPlaybackSession("node")
      ?.graph?.nodes.filter((node) => node.type === "station")
      .map((node) =>
        node.type === "station" ? String(node.data.radio?.id) : null
      );
    expect(stationIds).toEqual([inserted.id, "nts-local"]);
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

  test.each([
    ["merge", mergeImportedData],
    ["replace", replaceImportedData],
  ])(
    "%s restores the default level for a legacy graph-only backup",
    (_label, apply) => {
      seedLocalPatch();
      playbackSessionsCollection.update("node", (draft) => {
        draft.masterVolume = 0.2;
      });

      apply(
        rawBackup({
          sessions: { node: { graph: buildNodeGraphFromTemplate("blank") } },
        })
      );

      expect(getPlaybackSession("node")?.masterVolume).toBe(1);
    }
  );

  test.each([
    ["merge", mergeImportedData],
    ["replace", replaceImportedData],
  ])(
    "%s applies the imported Speakers level while Node plays",
    async (_label, apply) => {
      seedLocalPatch();
      settingsCollection.update(SETTINGS_ID, (draft) => {
        draft.player.mode = "node";
      });
      const snapshot = playingMode("node");
      const { getNodePlayback } = await import("@/lib/node-playback");
      // Node applies its master at its outputs, which re-read the session.
      const outputs = spyOn(getNodePlayback(), "masterVolumeChanged");

      apply(
        rawBackup({
          sessions: {
            node: {
              graph: buildNodeGraphFromTemplate("blank"),
              masterVolume: 0.1,
            },
          },
          settings: { player: { mode: "node" } },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getPlaybackSession("node")?.masterVolume).toBe(0.1);
      expect(outputs).toHaveBeenCalled();
      outputs.mockRestore();
      snapshot.mockRestore();
    }
  );

  test("an import that selects Node leaves the playing mode's level alone", async () => {
    seedLocalPatch();
    // The setting names Node at once; Single plays until Node activates.
    const snapshot = playingMode("single");
    const audio = AudioManager.getInstance();
    audio.setGlobalVolume(0.9);

    mergeImportedData(
      rawBackup({
        sessions: {
          node: {
            graph: buildNodeGraphFromTemplate("blank"),
            masterVolume: 0.1,
          },
        },
        settings: { player: { mode: "node" } },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSettings()?.player.mode).toBe("node");
    expect(audio.getGlobalVolume()).toBe(0.9);
    snapshot.mockRestore();
    AudioManager.resetInstance();
  });

  test("an import leaves another mode's level alone", async () => {
    seedLocalPatch();
    const audio = AudioManager.getInstance();
    audio.setGlobalVolume(0.9);

    mergeImportedData(
      rawBackup({
        sessions: {
          node: {
            graph: buildNodeGraphFromTemplate("blank"),
            masterVolume: 0.1,
          },
        },
        settings: { player: { mode: "single" } },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audio.getGlobalVolume()).toBe(0.9);
    AudioManager.resetInstance();
  });

  test.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.3", null])(
    "an invalid master level %p fails before changing the library, patch or history",
    (masterVolume) => {
      const local = seedLocalPatch();
      loadNodeGraph(local);
      const { history } = nodeStore.state;
      const backup = rawBackup({
        radios: [stationRadio("new")],
        sessions: {
          node: { graph: buildNodeGraphFromTemplate("blank"), masterVolume },
        },
        settings: { player: { mode: "dj", restoreStateOnLoad: false } },
      });
      const log = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(() => validateImportData(backup)).toThrow(
          "Invalid Node master volume"
        );
        expect(() => mergeImportedData(backup)).toThrow(
          "Invalid Node master volume"
        );
        expect(() => replaceImportedData(backup)).toThrow(
          "Invalid Node master volume"
        );
      } finally {
        log.mockRestore();
      }

      expect([...radiosCollection.state.keys()]).toEqual(["kexp"]);
      expect(getSettings()?.player).toEqual({
        mode: "single",
        restoreStateOnLoad: true,
      });
      expect(getPlaybackSession("node")?.graph).toEqual(local);
      expect(getPlaybackSession("node")?.masterVolume).toBe(1);
      expect(nodeStore.state.graph).toBe(local);
      expect(nodeStore.state.history).toBe(history);
    }
  );

  test("preview identifies patch and Speakers level replacement", () => {
    seedLocalPatch();
    expect(
      previewImportChanges(
        rawBackup({
          sessions: {
            node: {
              graph: buildNodeGraphFromTemplate("blank"),
              masterVolume: 0,
            },
          },
        })
      ).nodePatch
    ).toEqual({ masterVolume: 0, replacesNewerVersion: false });
    expect(previewImportChanges(rawBackup({})).nodePatch).toBeUndefined();
  });

  test("an explicit backup import can replace a future read-only patch", async () => {
    const session = buildNodeSessionFromGraph(
      buildNodeGraphFromTemplate("starter")
    );
    const graph = { ...session.graph, futureField: "keep me", version: 3 };
    writeLegacyRecord(playbackSessionsCollection, { ...session, graph });
    await new Promise((resolve) => setTimeout(resolve, 0));
    loadNodeGraphMigration(migrateNodeGraph(graph));
    const imported = buildNodeGraphFromTemplate("blank");

    mergeImportedData(rawBackup({ sessions: { node: { graph: imported } } }));

    expect(getPlaybackSession("node")?.graph).toEqual(imported);
    expect(nodeStore.state.graph).toEqual(imported);
    expect(nodeStore.state.readOnlyVersion).toBeNull();
    expect(undoNodeGraph()).toBe(false);
  });

  // A later release may change any shape, `nodes` included.
  test.each([
    ["`nodes` that is not a list", { nodes: { amp: { type: "neuralAmp" } } }],
    [
      "FX nodes of another shape",
      {
        nodes: [
          null,
          { type: "neuralAmp" },
          { data: { effect: "amp" }, type: "neuralAmp" },
          {
            data: { effect: { chains: 7, type: "fxComposite" } },
            type: "fxComposite",
          },
          {
            data: { effect: { modelId: 7, type: "neuralAmp" } },
            type: "neuralAmp",
          },
        ],
      },
    ],
  ])(
    "a backup does not fail on a future patch with %s",
    async (_label, shape) => {
      const session = buildNodeSessionFromGraph(
        buildNodeGraphFromTemplate("starter")
      );
      const graph = { ...shape, version: 3 };
      writeLegacyRecord(playbackSessionsCollection, { ...session, graph });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const exported = await createDatabaseExport();

      expect(exported.sessions?.node?.graph).toEqual(graph);
      expect(exported.namModels).toBeUndefined();
      expect(exported.missingNamModels).toBeUndefined();
    }
  );

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
      { edges: [], nodes: [speakersInput], version: 3 },
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

describe("local NAM file backups", () => {
  const dataSnapshot = (value: unknown) =>
    JSON.stringify(value, (key, current) =>
      key.startsWith("$") ? undefined : current
    );
  const bytes = '{"version":"0.5.2","weights":[1,2,3]}';
  const importers = [
    ["merge", mergeImportedData],
    ["replace", replaceImportedData],
  ] as const;

  function patchWithModel(modelId: string): NodeGraph {
    return nodeGraphSchema.parse({
      edges: [cable("src-kexp", "amp"), cable("amp", "speakers")],
      nodes: [
        stationInput("kexp"),
        {
          data: {
            effect: {
              ...createNodeEffectConfig("neuralAmp", "amp"),
              modelData: null,
              modelId,
              modelName: "amp.nam",
              modelUrl: null,
            },
          },
          id: "amp",
          position,
          type: "neuralAmp",
        },
        speakersInput,
      ],
      version: 2,
    });
  }

  test("a backup keeps the local models of a future patch", async () => {
    const session = buildNodeSessionFromGraph(
      buildNodeGraphFromTemplate("starter")
    );
    const modelId = createLocalNamModelId();
    await saveNamModel(modelId, bytes);
    const graph = { ...patchWithModel(modelId), version: 3 };
    writeLegacyRecord(playbackSessionsCollection, { ...session, graph });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const exported = await createDatabaseExport();

    expect(exported.sessions?.node?.graph).toEqual(graph);
    expect(exported.namModels).toEqual({ [modelId]: bytes });
    expect(exported.missingNamModels).toBeUndefined();
    await deleteNamModel(modelId);
  });

  test("a backup with Node data is version 3, a library-only one version 2", async () => {
    seedLocalPatch();
    expect((await createDatabaseExport()).version).toBe(3);

    await resetCollections();
    saveRadio(stationRadio("kexp"));
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    expect((await createDatabaseExport()).version).toBe(2);

    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = "node";
    });
    expect((await createDatabaseExport()).version).toBe(3);
  });

  test.each(importers)(
    "%s restores model bytes into a clean store",
    async (_label, apply) => {
      seedLocalPatch();
      const modelId = createLocalNamModelId();
      await saveNamModel(modelId, bytes);
      playbackSessionsCollection.update("node", (draft) => {
        draft.graph = patchWithModel(modelId);
      });
      const exported = await createDatabaseExport();
      expect(exported.namModels).toEqual({ [modelId]: bytes });
      await resetCollections();
      await deleteNamModel(modelId);

      await apply(parseImportData(JSON.stringify(exported)));

      const model = getPlaybackSession("node")?.graph?.nodes.find(
        (node) => node.type === "neuralAmp"
      );
      if (
        model?.type !== "neuralAmp" ||
        model.data.effect.type !== "neuralAmp"
      ) {
        throw new Error("Expected imported NAM effect");
      }
      const restoredId = model.data.effect.modelId;
      expect(restoredId).not.toBe(modelId);
      expect(model.data.effect.modelData).toBeNull();
      expect(await getNamModel(restoredId)).toBe(bytes);
      expect(getPlaybackSession("node")?.channels[0]?.effects[0]?.id).toBe(
        "amp"
      );
      await deleteNamModel(restoredId);
    }
  );

  test.each(importers)(
    "%s rejects malformed model bytes before changing any state",
    async (_label, apply) => {
      const local = seedLocalPatch();
      loadNodeGraph(local);
      const modelId = createLocalNamModelId();
      await saveNamModel(modelId, bytes);
      const library = dataSnapshot([...radiosCollection.state.values()]);
      const settings = dataSnapshot(getSettings());
      const session = dataSnapshot(getPlaybackSession("node"));
      const editor = nodeStore.state;
      const errors = spyOn(console, "error").mockImplementation(
        () => undefined
      );
      try {
        expect(() =>
          apply(
            rawBackup({
              namModels: { [modelId]: "[]" },
              radios: [stationRadio("new")],
              sessions: { node: { graph: patchWithModel(modelId) } },
              settings: { player: { mode: "dj" } },
            })
          )
        ).toThrow("NAM model must contain a JSON object");
        expect(dataSnapshot([...radiosCollection.state.values()])).toBe(
          library
        );
        expect(dataSnapshot(getSettings())).toBe(settings);
        expect(dataSnapshot(getPlaybackSession("node"))).toBe(session);
        expect(nodeStore.state).toBe(editor);
        expect(await getNamModel(modelId)).toBe(bytes);
      } finally {
        errors.mockRestore();
        await deleteNamModel(modelId);
      }
    }
  );

  test.each(importers)(
    "%s removes staged assets after collection persistence fails",
    async (_label, apply) => {
      const local = seedLocalPatch();
      loadNodeGraph(local);
      const modelId = createLocalNamModelId();
      const stagedId = createLocalNamModelId();
      const uuid = spyOn(crypto, "randomUUID").mockReturnValueOnce(
        stagedId.slice("local-nam:".length) as ReturnType<
          typeof crypto.randomUUID
        >
      );
      const library = dataSnapshot([...radiosCollection.state.values()]);
      const settings = dataSnapshot(getSettings());
      const session = dataSnapshot(getPlaybackSession("node"));
      const editor = nodeStore.state;
      const originalAccept = settingsCollection.utils.acceptMutations;
      const accept = spyOn(
        settingsCollection.utils,
        "acceptMutations"
      ).mockImplementationOnce((pending) => {
        originalAccept(pending);
        throw new Error("model import persistence failed");
      });
      const errors = spyOn(console, "error").mockImplementation(
        () => undefined
      );
      try {
        await expect(
          Promise.resolve(
            apply(
              rawBackup({
                namModels: { [modelId]: bytes },
                radios: [stationRadio("new")],
                sessions: { node: { graph: patchWithModel(modelId) } },
                settings: { player: { mode: "dj" } },
              })
            )
          )
        ).rejects.toThrow("model import persistence failed");
        expect(dataSnapshot([...radiosCollection.state.values()])).toBe(
          library
        );
        expect(dataSnapshot(getSettings())).toBe(settings);
        expect(dataSnapshot(getPlaybackSession("node"))).toBe(session);
        expect(nodeStore.state).toBe(editor);
        expect(await getNamModel(stagedId)).toBeNull();
        expect(await getNamModel(modelId)).toBeNull();
      } finally {
        uuid.mockRestore();
        accept.mockRestore();
        errors.mockRestore();
      }
    }
  );

  test.each(importers)(
    "%s imports a backup made without a model missing on its device",
    async (_label, apply) => {
      seedLocalPatch();
      const goneId = createLocalNamModelId();
      playbackSessionsCollection.update("node", (draft) => {
        draft.graph = patchWithModel(goneId);
      });
      const warnings = spyOn(console, "warn").mockImplementation(
        () => undefined
      );
      try {
        // The model's file is gone, yet stations and the patch back up.
        const exported = await createDatabaseExport();
        expect(exported.missingNamModels).toEqual([goneId]);
        expect(exported.namModels).toBeUndefined();
        expect(exported.radios).toHaveLength(1);
        await resetCollections();

        await apply(parseImportData(JSON.stringify(exported)));
      } finally {
        warnings.mockRestore();
      }

      const amp = getPlaybackSession("node")?.graph?.nodes.find(
        (node) => node.type === "neuralAmp"
      );
      if (amp?.type !== "neuralAmp" || amp.data.effect.type !== "neuralAmp") {
        throw new Error("Expected imported NAM effect");
      }
      expect(amp.data.effect.modelId).toBeNull();
    }
  );

  test("a legacy backup without available model bytes reports the missing model", async () => {
    const local = seedLocalPatch();
    loadNodeGraph(local);
    const missingId = createLocalNamModelId();
    const errorToast = spyOn(toast, "error");
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        Promise.resolve(
          replaceImportedData(
            rawBackup({
              sessions: { node: { graph: patchWithModel(missingId) } },
            })
          )
        )
      ).rejects.toThrow("Missing local NAM model: amp.nam");
      expect(errorToast).toHaveBeenCalledWith(
        "Missing local NAM model: amp.nam"
      );
      expect(getPlaybackSession("node")?.graph).toEqual(local);
      expect(nodeStore.state.graph).toEqual(local);
    } finally {
      errorToast.mockRestore();
      errors.mockRestore();
    }
  });
});
