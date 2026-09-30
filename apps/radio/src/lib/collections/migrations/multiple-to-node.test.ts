import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { buildNodeSessionFromTemplate } from "@/lib/node-graph/templates";
import {
  buildMultipleSessionFromRadios,
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackSession,
  initializePlaybackSessions,
  parsePlaybackSessionRecord,
  playbackSessionsCollection,
  stopLegacyMultipleListeners,
} from "../playback-sessions";
import { radiosCollection } from "../radios";
import { addSessionRadio, sessionRadiosCollection } from "../session-radios";
import { getSettings, settingsCollection } from "../settings";
import {
  buildNodeGraphFromMultipleRecord,
  buildNodeSessionFromMultipleRecord,
  MULTIPLE_BACKUP_STORAGE_KEY,
  type MultipleBackup,
  migrateMultipleSession,
  watchLegacyMultipleWrites,
} from "./multiple-to-node";
import { runRawStorageScenario } from "./raw-storage-scenario";

const SETTINGS_ID = "app-settings";
const collections = {
  radios: radiosCollection,
  sessionRadios: sessionRadiosCollection,
  sessions: playbackSessionsCollection,
};

function createMemoryStorage() {
  const state = new Map<string, string>();
  return {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: mock((key: string, value: string) => {
      state.set(key, value);
    }),
  };
}

function radio(id: string, name = id.toUpperCase()): Radio {
  return { id, name, streamUrl: `https://radio.example/${id}.mp3` };
}

function saveRadio(station: Radio, order = 0) {
  radiosCollection.insert({
    ...station,
    enabled: true,
    id: String(station.id),
    isSystem: false,
    order,
  });
}

/** A `"multiple"` record holding `stations` at the given levels, in order. */
function insertMultiple(
  stations: Array<{ radio: Radio; volume?: number; muted?: boolean }>,
  masterVolume = 1
) {
  playbackSessionsCollection.insert({
    ...buildMultipleSessionFromRadios([]),
    channels: stations.map((station, order) => ({
      ...createDefaultChannel(
        getMultipleChannelId(station.radio),
        "multiple",
        order
      ),
      muted: station.muted ?? false,
      radio: station.radio,
      volume: station.volume ?? 1,
    })),
    masterVolume,
  });
}

async function reset() {
  stopLegacyMultipleListeners();
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
  ]);
  for (const collection of [
    playbackSessionsCollection,
    radiosCollection,
    settingsCollection,
    sessionRadiosCollection,
  ] as const) {
    for (const key of Array.from(collection.state.keys())) {
      collection.delete(key as never);
    }
  }
}

beforeEach(reset);
afterEach(reset);

describe("migrateMultipleSession", () => {
  test("drops a channel whose session radio left sessionStorage", () => {
    saveRadio(radio("kexp"));
    addSessionRadio(radio("rg_live"));
    insertMultiple([
      { radio: radio("kexp") },
      { radio: radio("rg_gone") },
      { radio: radio("rg_live") },
      // Saved once, deleted since.
      { radio: radio("deleted") },
    ]);

    migrateMultipleSession(collections, createMemoryStorage());

    const node = getPlaybackSession("node");
    expect(node?.graph?.nodes.map((entry) => entry.id)).toEqual([
      "src-kexp",
      "src-rg_live",
      "speakers",
    ]);
    expect(node?.channels.map((channel) => channel.id)).toEqual([
      "n:src-kexp",
      "n:src-rg_live",
    ]);
    expect(getPlaybackSession("multiple")).toBeUndefined();
  });

  test("carries masterVolume to Speakers and each channel's level to its Station", () => {
    saveRadio(radio("kexp"));
    saveRadio(radio("nts"), 1);
    insertMultiple(
      [
        { muted: true, radio: radio("kexp"), volume: 0.4 },
        { radio: radio("nts"), volume: 0.7 },
      ],
      0.35
    );

    migrateMultipleSession(collections, createMemoryStorage());

    const node = getPlaybackSession("node");
    expect(node?.masterVolume).toBe(0.35);
    expect(node?.graph?.nodes.map((entry) => entry.data)).toEqual([
      { muted: true, radio: radio("kexp"), volume: 0.4 },
      { muted: false, radio: radio("nts"), volume: 0.7 },
      { muted: false },
    ]);
    expect(
      node?.channels.map(({ muted, volume }) => ({ muted, volume }))
    ).toEqual([
      { muted: true, volume: 0.4 },
      { muted: false, volume: 0.7 },
    ]);
    // Every Station is cabled to Speakers at x 480, centred on the column.
    expect(node?.graph?.edges.map((edge) => edge.id)).toEqual([
      "src-kexp->speakers",
      "src-nts->speakers",
    ]);
    expect(node?.graph?.nodes.at(-1)?.position).toEqual({ x: 480, y: 80 });
  });

  test("keeps Multiple's channel order", () => {
    for (const [order, id] of ["a", "b", "c"].entries()) {
      saveRadio(radio(id), order);
    }
    insertMultiple([
      { radio: radio("a") },
      { radio: radio("b") },
      { radio: radio("c") },
    ]);
    // Stored order wins over array order.
    playbackSessionsCollection.update("multiple", (draft) => {
      const [first, second, third] = draft.channels;
      if (!(first && second && third)) {
        throw new Error("Expected three channels");
      }
      first.order = 2;
      second.order = 0;
      third.order = 1;
    });

    migrateMultipleSession(collections, createMemoryStorage());

    const node = getPlaybackSession("node");
    expect(node?.channels.map((channel) => channel.radio?.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(
      node?.graph?.nodes
        .filter((entry) => entry.type === "station")
        .map((entry) => entry.position.y)
    ).toEqual([0, 160, 320]);
  });

  test("writes the backup once, with the raw record and the old mode", () => {
    const storage = createMemoryStorage();
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "multiple", restoreStateOnLoad: true },
    });
    saveRadio(radio("kexp"));
    insertMultiple([{ radio: radio("kexp"), volume: 0.5 }], 0.6);
    const raw = playbackSessionsCollection.state.get("multiple");

    migrateMultipleSession(collections, storage);
    // A later Multiple record, even after Node is gone, keeps the first backup.
    insertMultiple([{ radio: radio("kexp") }]);
    migrateMultipleSession(collections, storage);
    playbackSessionsCollection.delete("node");
    insertMultiple([{ radio: radio("kexp") }]);
    migrateMultipleSession(collections, storage);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const backup = JSON.parse(
      storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY) ?? "null"
    ) as MultipleBackup;
    expect(backup.mode).toBe("multiple");
    // The record as stored, without the collection's virtual `$` fields.
    expect(backup.session).toEqual(
      JSON.parse(JSON.stringify(parsePlaybackSessionRecord(raw)))
    );
    expect(backup.session).not.toHaveProperty("$synced");
    expect(typeof backup.createdAt).toBe("number");
  });

  test("lays out more than eight Stations in two columns", () => {
    const stations = Array.from({ length: 10 }, (_, index) =>
      radio(`s${index}`)
    );
    for (const [order, station] of stations.entries()) {
      saveRadio(station, order);
    }
    insertMultiple(stations.map((station) => ({ radio: station })));

    migrateMultipleSession(collections, createMemoryStorage());

    const nodes = getPlaybackSession("node")?.graph?.nodes ?? [];
    expect(nodes.slice(0, 10).map((entry) => entry.position)).toEqual(
      stations.map((_, index) => ({
        x: index < 5 ? 0 : 280,
        y: (index % 5) * 160,
      }))
    );
    // Speakers clears the second column and stays vertically centred.
    expect(nodes.at(-1)).toMatchObject({
      position: { x: 760, y: 320 },
      type: "speakers",
    });
  });

  test("is idempotent", () => {
    saveRadio(radio("kexp"));
    insertMultiple([{ radio: radio("kexp"), volume: 0.3 }], 0.5);
    const storage = createMemoryStorage();

    migrateMultipleSession(collections, storage);
    const migrated = getPlaybackSession("node");
    migrateMultipleSession(collections, storage);

    expect(getPlaybackSession("node")).toEqual(migrated);
    expect(getPlaybackSession("multiple")).toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test("only deletes multiple when node already exists", () => {
    saveRadio(radio("kexp"));
    const existing = buildNodeSessionFromTemplate("blank", {
      masterVolume: 0.9,
    });
    playbackSessionsCollection.insert(existing);
    insertMultiple([{ radio: radio("kexp") }], 0.1);
    const storage = createMemoryStorage();

    migrateMultipleSession(collections, storage);

    expect(getPlaybackSession("node")).toMatchObject(existing);
    expect(getPlaybackSession("multiple")).toBeUndefined();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test("reads a legacy record leniently", () => {
    const graph = buildNodeGraphFromMultipleRecord(
      {
        channels: [
          { radio: radio("kexp"), volume: 3 },
          { radio: { name: "No stream" } },
          "garbage",
          { muted: true, radio: radio("nts") },
        ],
        id: "multiple",
      },
      () => true
    );

    expect(graph.nodes.map((entry) => entry.data)).toEqual([
      { muted: false, radio: radio("kexp"), volume: 1 },
      { muted: true, radio: radio("nts"), volume: 1 },
      { muted: false },
    ]);
    expect(buildNodeGraphFromMultipleRecord(null, () => true).nodes).toEqual([
      expect.objectContaining({ type: "speakers" }),
    ]);
  });

  test("keeps a station whose old snapshot the schema now rejects", () => {
    const stale = {
      ...radio("kexp"),
      logoUrl: "https://radio.example/kexp.png",
      metadataConfig: { kind: "retired-provider" },
    };
    const valid: Radio = {
      ...radio("nts"),
      metadataConfig: { channel: "1", kind: "nts-live-api" },
    };

    const session = buildNodeSessionFromMultipleRecord(
      { channels: [{ radio: stale }, { radio: valid }], id: "multiple" },
      () => true
    );

    // The record the migration inserts passes the session schema.
    expect(() => parsePlaybackSessionRecord(session)).not.toThrow();
    expect(session.channels.map((channel) => channel.radio)).toEqual([
      radio("kexp"),
      valid,
    ]);
  });

  test("still deletes multiple when the node insert fails", () => {
    const warn = mock(() => undefined);
    const originalWarn = console.warn;
    console.warn = warn;
    const deleted: string[] = [];
    const sessions = {
      delete: (id: string) => deleted.push(id),
      insert: () => {
        throw new Error("SchemaValidationError");
      },
      state: new Map([["multiple", { channels: [], id: "multiple" }]]),
    } as unknown as typeof playbackSessionsCollection;
    const storage = createMemoryStorage();

    try {
      expect(() =>
        migrateMultipleSession({ ...collections, sessions }, storage)
      ).not.toThrow();
    } finally {
      console.warn = originalWarn;
    }

    expect(deleted).toEqual(["multiple"]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("initializePlaybackSessions", () => {
  test("migrates before anything updates the session collection", async () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "multiple", restoreStateOnLoad: true },
    });
    saveRadio(radio("kexp"));
    insertMultiple([{ radio: radio("kexp"), volume: 0.25 }], 0.45);

    await initializePlaybackSessions();

    expect(getPlaybackSession("multiple")).toBeUndefined();
    expect(getPlaybackSession("node")?.masterVolume).toBe(0.45);
    expect(getPlaybackSession("node")?.channels[0]?.volume).toBe(0.25);
    expect(getPlaybackSession("single")).toBeDefined();
    expect(getPlaybackSession("dj")).toBeDefined();
  });

  test("builds Node from Start from Multiple on a fresh store", async () => {
    saveRadio(radio("kexp"));
    addSessionRadio(radio("rg_live"));

    await initializePlaybackSessions();

    const node = getPlaybackSession("node");
    expect(node?.graph?.nodes.map((entry) => entry.id)).toEqual([
      "src-kexp",
      "src-rg_live",
      "speakers",
    ]);
    expect(getPlaybackSession("multiple")).toBeUndefined();
  });

  test("removes a multiple record another tab writes after init", async () => {
    saveRadio(radio("kexp"));
    await initializePlaybackSessions();
    const node = getPlaybackSession("node");

    insertMultiple([{ radio: radio("kexp") }], 0.2);
    await Promise.resolve();

    expect(getPlaybackSession("multiple")).toBeUndefined();
    expect(getPlaybackSession("node")).toEqual(node);
  });
});

describe("watchLegacyMultipleWrites", () => {
  test("rewrites a synced multiple mode and moves this tab to Node", async () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    const requestMode = mock(async (_mode: string) => undefined);
    const stop = watchLegacyMultipleWrites({
      ...collections,
      requestMode,
      settings: settingsCollection,
    });

    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = "multiple";
    });
    await Promise.resolve();
    stop();

    expect(getSettings()?.player.mode).toBe("node");
    expect(requestMode).toHaveBeenCalledTimes(1);
    expect(requestMode).toHaveBeenCalledWith("node");
  });

  test("ignores the modes it offers", async () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    const requestMode = mock(async (_mode: string) => undefined);
    const stop = watchLegacyMultipleWrites({
      ...collections,
      requestMode,
      settings: settingsCollection,
    });

    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = "dj";
    });
    await Promise.resolve();
    stop();

    expect(requestMode).not.toHaveBeenCalled();
  });
});

describe("from raw localStorage", () => {
  for (const restoreStateOnLoad of [true, false]) {
    test(`migrates and later updates validate (restoreStateOnLoad ${restoreStateOnLoad})`, async () => {
      const result = await runRawStorageScenario({
        crossTab: false,
        restoreStateOnLoad,
      });

      expect(result.errors).toEqual([]);
      expect(result.mode).toBe("node");
      expect(result.sessionIds).toEqual(["dj", "node", "single"]);
      // What reaches storage holds no "multiple" either, so dropping it from
      // the schemas cannot fail a later load.
      expect(result.storedMode).toBe("node");
      expect(result.storedSessionIds).toEqual(["dj", "node", "single"]);
      expect(result.backup?.mode).toBe("multiple");
      // Restore keeps the kept stations and the old master; without it,
      // Node is rebuilt from the enabled saved and session stations.
      expect(result.nodeStations).toEqual(["src-kexp", "src-rg_live"]);
      expect(result.masterVolume).toBe(restoreStateOnLoad ? 0.3 : 1);
      expect(result.laneVolumes).toEqual([0.9, 1]);
    });
  }

  test("a multiple record synced from another tab is removed", async () => {
    const result = await runRawStorageScenario({
      crossTab: true,
      restoreStateOnLoad: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.sessionIds).toEqual(["dj", "node", "single"]);
    expect(result.crossTabMultipleSynced).toBe(true);
    expect(result.crossTabNodeUnchanged).toBe(true);
    expect(result.mode).toBe("node");
    expect(result.storedSessionIds).toEqual(["dj", "node", "single"]);
  });

  test("settings that fail validation elsewhere do not stop init", async () => {
    const result = await runRawStorageScenario({
      crossTab: false,
      restoreStateOnLoad: true,
      staleSettings: true,
    });

    // The mode could not be rewritten, but the sessions still migrated.
    expect(result.storedSessionIds).toEqual(["dj", "node", "single"]);
    expect(result.nodeStations).toEqual(["src-kexp", "src-rg_live"]);
    expect(result.backup?.mode).toBe("multiple");
  });
});
