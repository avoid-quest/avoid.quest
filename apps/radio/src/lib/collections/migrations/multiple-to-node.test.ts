import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/routing/effect-tree";
import type { Radio } from "@/lib/audio/playback/types";
import { DEFAULT_STATION_STRIP } from "@/lib/node-graph/schema";
import { buildNodeSessionFromTemplate } from "@/lib/node-graph/templates";
import {
  createDefaultChannel,
  getPlaybackSession,
  initializePlaybackSessions,
  PLAYBACK_SESSIONS_STORAGE_KEY,
  parsePlaybackSessionRecord,
  playbackSessionsCollection,
  stopLegacyMultipleListeners,
} from "../playback-sessions";
import { radiosCollection } from "../radios";
import { addSessionRadio, sessionRadiosCollection } from "../session-radios";
import {
  getSettings,
  SETTINGS_STORAGE_KEY,
  settingsCollection,
} from "../settings";
import {
  LEGACY_MULTIPLE_SESSION_ID,
  writeLegacyRecord,
} from "./legacy-records";
import {
  buildNodeGraphFromMultipleRecord,
  buildNodeSessionFromMultipleRecord,
  MULTIPLE_BACKUP_STORAGE_KEY,
  type MultipleBackup,
  migrateMultipleSession,
  watchLegacyMultipleWrites,
} from "./multiple-to-node";
import { parseMultipleSessionRecord } from "./node-to-multiple";
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
    clear: () => state.clear(),
    getItem: (key: string) => state.get(key) ?? null,
    key: (index: number) => [...state.keys()][index] ?? null,
    get length() {
      return state.size;
    },
    removeItem: (key: string) => {
      state.delete(key);
    },
    setItem: mock((key: string, value: string) => {
      state.set(key, value);
    }),
  } satisfies Storage;
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

type MultipleStation = {
  radio: Radio;
  volume?: number;
  muted?: boolean;
  order?: number;
};

/** A `"multiple"` record holding `stations` at the given levels, in order. */
function multipleRecord(stations: MultipleStation[], masterVolume = 1) {
  return {
    activeChannelId: null,
    channels: stations.map((station, index) => ({
      ...createDefaultChannel(
        `multi:${String(station.radio.id)}`,
        "node",
        station.order ?? index
      ),
      muted: station.muted ?? false,
      radio: station.radio,
      role: "multiple",
      volume: station.volume ?? 1,
    })),
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id: "multiple",
    masterVolume,
    tempo: DEFAULT_EFFECT_TEMPO,
  };
}

/** Lets unvalidated writes land; they wait for pending mutations to persist. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Stores a Multiple record the way an older release left it. */
async function insertMultiple(stations: MultipleStation[], masterVolume = 1) {
  const record = multipleRecord(stations, masterVolume);
  // A delete still persisting would clash with the write.
  await settle();
  writeLegacyRecord(playbackSessionsCollection, record);
  await settle();
  return record;
}

/** Stores settings whose mode is still "multiple". */
async function insertMultipleSettings() {
  writeLegacyRecord(settingsCollection, {
    id: SETTINGS_ID,
    player: { mode: "multiple", restoreStateOnLoad: true },
  });
  await settle();
}

/** Stands in for storage events: `write` is another tab writing `key`. */
function createOtherTabWrites() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    subscribe: (key: string, listener: () => void) => {
      const keyListeners = listeners.get(key) ?? new Set();
      keyListeners.add(listener);
      listeners.set(key, keyListeners);
      return () => keyListeners.delete(listener);
    },
    write: (key: string) => {
      for (const listener of listeners.get(key) ?? []) {
        listener();
      }
    },
  };
}

/**
 * A window whose storage events reach this tab's listeners, until
 * `restore`. Its localStorage is also the global one the migration backs
 * up to; the collections keep their in-memory storage.
 */
function installOtherTabWindow() {
  type StorageListener = (
    event: Pick<StorageEvent, "key" | "storageArea">
  ) => void;
  const listeners = new Set<StorageListener>();
  const localStorage = createMemoryStorage();
  const globals = {
    localStorage,
    window: {
      addEventListener: (_type: string, listener: StorageListener) =>
        listeners.add(listener),
      localStorage,
      removeEventListener: (_type: string, listener: StorageListener) =>
        listeners.delete(listener),
    },
  };
  const descriptors = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  return {
    localStorage,
    restore: () => {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, key);
        }
      }
    },
    write: (key: string) => {
      for (const listener of listeners) {
        listener({ key, storageArea: localStorage });
      }
    },
  };
}

function hasMultiple(): boolean {
  return playbackSessionsCollection.state.has(LEGACY_MULTIPLE_SESSION_ID);
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
  test("drops a channel whose session radio left sessionStorage", async () => {
    saveRadio(radio("kexp"));
    addSessionRadio(radio("rg_live"));
    await insertMultiple([
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
    expect(hasMultiple()).toBe(false);
  });

  test("keeps a saved station whose id has a discovery prefix", async () => {
    // An imported library keeps its ids, discovery prefixes included.
    saveRadio(radio("rg_saved"));
    await insertMultiple([{ radio: radio("rg_saved") }]);

    migrateMultipleSession(collections, createMemoryStorage());

    expect(
      getPlaybackSession("node")?.graph?.nodes.map((entry) => entry.id)
    ).toEqual(["src-rg_saved", "speakers"]);
  });

  test("carries masterVolume to Speakers and each channel's level to its Station", async () => {
    saveRadio(radio("kexp"));
    saveRadio(radio("nts"), 1);
    await insertMultiple(
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
      {
        muted: true,
        radio: radio("kexp"),
        strip: DEFAULT_STATION_STRIP,
        volume: 0.4,
      },
      {
        muted: false,
        radio: radio("nts"),
        strip: DEFAULT_STATION_STRIP,
        volume: 0.7,
      },
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
    expect(node?.graph?.nodes.at(-1)?.position).toEqual({ x: 480, y: 95 });
  });

  test("keeps Multiple's channel order", async () => {
    for (const [order, id] of ["a", "b", "c"].entries()) {
      saveRadio(radio(id), order);
    }
    // Stored order wins over array order.
    await insertMultiple([
      { order: 2, radio: radio("a") },
      { order: 0, radio: radio("b") },
      { order: 1, radio: radio("c") },
    ]);

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
    ).toEqual([0, 190, 380]);
  });

  test("writes the backup once, with the raw record and the old mode", async () => {
    const storage = createMemoryStorage();
    await insertMultipleSettings();
    saveRadio(radio("kexp"));
    const raw = await insertMultiple(
      [{ radio: radio("kexp"), volume: 0.5 }],
      0.6
    );

    migrateMultipleSession(collections, storage);
    // A later Multiple record, even after Node is gone, keeps the first backup.
    await insertMultiple([{ radio: radio("kexp") }]);
    migrateMultipleSession(collections, storage);
    playbackSessionsCollection.delete("node");
    await insertMultiple([{ radio: radio("kexp") }]);
    migrateMultipleSession(collections, storage);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const backup = JSON.parse(
      storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY) ?? "null"
    ) as MultipleBackup;
    expect(backup.mode).toBe("multiple");
    // The record as stored, without the collection's virtual `$` fields.
    expect(backup.session).toEqual(raw);
    expect(backup.session).not.toHaveProperty("$synced");
    expect(typeof backup.createdAt).toBe("number");
  });

  test("lays out more than eight Stations in two columns", async () => {
    const stations = Array.from({ length: 10 }, (_, index) =>
      radio(`s${index}`)
    );
    for (const [order, station] of stations.entries()) {
      saveRadio(station, order);
    }
    await insertMultiple(stations.map((station) => ({ radio: station })));

    migrateMultipleSession(collections, createMemoryStorage());

    const nodes = getPlaybackSession("node")?.graph?.nodes ?? [];
    expect(nodes.slice(0, 10).map((entry) => entry.position)).toEqual(
      stations.map((_, index) => ({
        x: index < 5 ? 0 : 280,
        y: (index % 5) * 190,
      }))
    );
    // Speakers clears the second column and stays vertically centred.
    expect(nodes.at(-1)).toMatchObject({
      position: { x: 760, y: 380 },
      type: "speakers",
    });
  });

  test("is idempotent", async () => {
    saveRadio(radio("kexp"));
    await insertMultiple([{ radio: radio("kexp"), volume: 0.3 }], 0.5);
    const storage = createMemoryStorage();

    migrateMultipleSession(collections, storage);
    const migrated = getPlaybackSession("node");
    migrateMultipleSession(collections, storage);

    expect(getPlaybackSession("node")).toEqual(migrated);
    expect(hasMultiple()).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test("only deletes multiple when node already exists", async () => {
    saveRadio(radio("kexp"));
    const existing = buildNodeSessionFromTemplate("blank", {
      masterVolume: 0.9,
    });
    playbackSessionsCollection.insert(existing);
    await insertMultiple([{ radio: radio("kexp") }], 0.1);
    const storage = createMemoryStorage();
    storage.setItem(
      MULTIPLE_BACKUP_STORAGE_KEY,
      JSON.stringify({
        createdAt: 1,
        mode: "multiple",
        session: { channels: [], id: "multiple" },
      })
    );
    storage.setItem.mockClear();

    migrateMultipleSession(collections, storage);

    expect(getPlaybackSession("node")).toMatchObject(existing);
    expect(hasMultiple()).toBe(false);
    // The backup written first stays.
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test("backs up a multiple record before deleting it beside node", async () => {
    playbackSessionsCollection.insert(buildNodeSessionFromTemplate("blank"));
    const record = await insertMultiple([{ radio: radio("kexp") }], 0.1);
    const storage = createMemoryStorage();

    migrateMultipleSession(collections, storage);

    expect(hasMultiple()).toBe(false);
    const raw = storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY);
    expect((JSON.parse(raw ?? "{}") as MultipleBackup).session).toEqual(record);
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
      {
        muted: false,
        radio: radio("kexp"),
        strip: DEFAULT_STATION_STRIP,
        volume: 1,
      },
      {
        muted: true,
        radio: radio("nts"),
        strip: DEFAULT_STATION_STRIP,
        volume: 1,
      },
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

  const unusableStorages = {
    "a blocked storage": () => null,
    "a storage that refuses writes": () => ({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    }),
  };
  for (const [name, createStorage] of Object.entries(unusableStorages)) {
    test(`keeps multiple when the node insert fails with ${name}`, () => {
      const originalWarn = console.warn;
      console.warn = mock(() => undefined);
      const deleted: string[] = [];
      const sessions = {
        delete: (id: string) => deleted.push(id),
        insert: () => {
          throw new Error("SchemaValidationError");
        },
        state: new Map([["multiple", { channels: [], id: "multiple" }]]),
      } as unknown as typeof playbackSessionsCollection;

      try {
        migrateMultipleSession({ ...collections, sessions }, createStorage());
      } finally {
        console.warn = originalWarn;
      }

      expect(deleted).toEqual([]);
    });
  }

  test("replaces a corrupt backup before giving up the record", () => {
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);
    const deleted: string[] = [];
    const record = { channels: [], id: "multiple" };
    const sessions = {
      delete: (id: string) => deleted.push(id),
      insert: () => {
        throw new Error("SchemaValidationError");
      },
      state: new Map([["multiple", record]]),
    } as unknown as typeof playbackSessionsCollection;
    const storage = createMemoryStorage();
    storage.setItem(MULTIPLE_BACKUP_STORAGE_KEY, "{not json");

    try {
      migrateMultipleSession({ ...collections, sessions }, storage);
    } finally {
      console.warn = originalWarn;
    }

    const backup = JSON.parse(
      storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY) ?? "{}"
    ) as MultipleBackup;
    expect(backup.session).toEqual(record);
    expect(deleted).toEqual(["multiple"]);
  });

  test("replaces a backup whose session a rollback cannot parse", async () => {
    playbackSessionsCollection.insert(buildNodeSessionFromTemplate("blank"));
    const record = await insertMultiple([{ radio: radio("kexp") }], 0.1);
    const storage = createMemoryStorage();
    storage.setItem(
      MULTIPLE_BACKUP_STORAGE_KEY,
      JSON.stringify({ createdAt: 1, mode: "multiple", session: {} })
    );

    migrateMultipleSession(collections, storage);

    expect(hasMultiple()).toBe(false);
    const raw = storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY);
    expect((JSON.parse(raw ?? "{}") as MultipleBackup).session).toEqual(record);
  });

  test("keeps multiple beside node when its backup cannot be read back", async () => {
    playbackSessionsCollection.insert(buildNodeSessionFromTemplate("blank"));
    await settle();
    // A record the rollback parser rejects: its channels are not channels.
    writeLegacyRecord(playbackSessionsCollection, {
      channels: ["garbage"],
      id: "multiple",
    });
    await settle();

    migrateMultipleSession(collections, createMemoryStorage());

    expect(hasMultiple()).toBe(true);
  });

  test("a kept record migrates once the backup can be written", async () => {
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);
    // Node came from the Starter patch after a failed run.
    playbackSessionsCollection.insert(buildNodeSessionFromTemplate("starter"));
    await insertMultiple([{ radio: radio("kexp") }]);

    try {
      migrateMultipleSession(collections, {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      });
    } finally {
      console.warn = originalWarn;
    }
    expect(hasMultiple()).toBe(true);

    const storage = createMemoryStorage();
    migrateMultipleSession(collections, storage);
    expect(hasMultiple()).toBe(false);
    expect(storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY)).not.toBeNull();
  });

  /**
   * The session collection, except that a Node insert lands in memory and
   * its write to storage settles with `persisted`.
   */
  function sessionsPersistingOn(persisted: Promise<void>) {
    return {
      delete: (id: never) => playbackSessionsCollection.delete(id),
      insert: (
        record: Parameters<typeof playbackSessionsCollection.insert>[0]
      ) => {
        playbackSessionsCollection.insert(record);
        return { isPersisted: { promise: persisted } };
      },
      get state() {
        return playbackSessionsCollection.state;
      },
    } as unknown as typeof playbackSessionsCollection;
  }

  /** A storage too full for the backup. */
  const fullStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  for (const stored of [true, false]) {
    test(`without a backup, multiple ${stored ? "goes once Node is stored" : "stays when Node cannot be stored"}`, async () => {
      const originalWarn = console.warn;
      console.warn = mock(() => undefined);
      await insertMultiple([{ radio: radio("kexp") }]);
      const persisted = Promise.withResolvers<void>();
      const sessions = sessionsPersistingOn(persisted.promise);

      try {
        migrateMultipleSession({ ...collections, sessions }, fullStorage);
        expect(hasMultiple()).toBe(true);

        if (stored) {
          persisted.resolve();
        } else {
          persisted.reject(new Error("QuotaExceededError"));
        }
        await settle();
      } finally {
        console.warn = originalWarn;
      }
      expect(hasMultiple()).toBe(!stored);
    });
  }

  test("without a backup, a newer multiple written meanwhile stays", async () => {
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);
    await insertMultiple([{ radio: radio("kexp") }]);
    const persisted = Promise.withResolvers<void>();
    const sessions = sessionsPersistingOn(persisted.promise);
    let newer: ReturnType<typeof multipleRecord>;

    try {
      migrateMultipleSession({ ...collections, sessions }, fullStorage);
      // A tab still on Multiple stores a newer session before Node is
      // stored. Node was built from the older one, and no backup holds it.
      newer = await insertMultiple([{ radio: radio("nts") }], 0.4);
      persisted.resolve();
      await settle();
    } finally {
      console.warn = originalWarn;
    }
    expect(
      playbackSessionsCollection.state.get(LEGACY_MULTIPLE_SESSION_ID)
    ).toMatchObject(newer);
  });
});

describe("initializePlaybackSessions", () => {
  test("migrates before anything updates the session collection", async () => {
    await insertMultipleSettings();
    saveRadio(radio("kexp"));
    await insertMultiple([{ radio: radio("kexp"), volume: 0.25 }], 0.45);

    await initializePlaybackSessions();

    expect(hasMultiple()).toBe(false);
    expect(getPlaybackSession("node")?.masterVolume).toBe(0.45);
    expect(getPlaybackSession("node")?.channels[0]?.volume).toBe(0.25);
    expect(getPlaybackSession("single")).toBeDefined();
    expect(getPlaybackSession("dj")).toBeDefined();
  });

  test("builds Node from the Starter patch on a fresh store", async () => {
    saveRadio(radio("kexp"));
    addSessionRadio(radio("rg_live"));

    await initializePlaybackSessions();

    const node = getPlaybackSession("node");
    expect(node?.graph?.nodes.map((entry) => entry.id)).toEqual([
      "src-station",
      "speakers",
    ]);
    expect(hasMultiple()).toBe(false);
  });

  test("removes a multiple record another tab writes after init", async () => {
    const otherTab = installOtherTabWindow();
    try {
      saveRadio(radio("kexp"));
      await initializePlaybackSessions();
      await settle();
      const node = getPlaybackSession("node");

      // The other tab's record, as the collection's own sync takes it in.
      const record = await insertMultiple([{ radio: radio("kexp") }], 0.2);
      expect(hasMultiple()).toBe(true);
      otherTab.write(PLAYBACK_SESSIONS_STORAGE_KEY);
      await Promise.resolve();

      expect(hasMultiple()).toBe(false);
      expect(getPlaybackSession("node")).toEqual(node);
      // Backed up to localStorage before it went.
      const backup = otherTab.localStorage.getItem(MULTIPLE_BACKUP_STORAGE_KEY);
      expect((JSON.parse(backup ?? "{}") as MultipleBackup).session).toEqual(
        record
      );
    } finally {
      stopLegacyMultipleListeners();
      otherTab.restore();
    }
  });

  test("leaves a multiple record this tab's own write brings back", async () => {
    // A write that fails to persist rolls back in this tab, and sends no
    // storage event; re-running the step on it would fail again.
    const otherTab = installOtherTabWindow();
    try {
      await initializePlaybackSessions();
      await settle();

      await insertMultiple([{ radio: radio("kexp") }], 0.2);
      await Promise.resolve();

      expect(hasMultiple()).toBe(true);
    } finally {
      stopLegacyMultipleListeners();
      otherTab.restore();
    }
  });
});

describe("watchLegacyMultipleWrites", () => {
  test("rewrites a synced multiple mode and moves this tab to Node", async () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    const requestMode = mock(async (_mode: string) => undefined);
    const otherTab = createOtherTabWrites();
    const stop = watchLegacyMultipleWrites({
      ...collections,
      otherTabWrites: otherTab.subscribe,
      requestMode,
    });

    await insertMultipleSettings();
    otherTab.write(SETTINGS_STORAGE_KEY);
    stop();

    expect(getSettings()?.player.mode).toBe("node");
    expect(requestMode).toHaveBeenCalledTimes(1);
    expect(requestMode).toHaveBeenCalledWith("node");
  });

  test("ignores the modes it offers", () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    const requestMode = mock(async (_mode: string) => undefined);
    const otherTab = createOtherTabWrites();
    const stop = watchLegacyMultipleWrites({
      ...collections,
      otherTabWrites: otherTab.subscribe,
      requestMode,
    });

    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = "dj";
    });
    otherTab.write(SETTINGS_STORAGE_KEY);
    stop();

    expect(requestMode).not.toHaveBeenCalled();
  });

  test("leaves a multiple mode this tab's own write brings back", async () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    const requestMode = mock(async (_mode: string) => undefined);
    const otherTab = createOtherTabWrites();
    const stop = watchLegacyMultipleWrites({
      ...collections,
      otherTabWrites: otherTab.subscribe,
      requestMode,
    });

    await insertMultipleSettings();
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
      // What reaches storage holds no "multiple" either, which the schemas
      // no longer accept, so a later load cannot fail on it.
      expect(result.storedMode).toBe("node");
      expect(result.storedSessionIds).toEqual(["dj", "node", "single"]);
      expect(result.backup?.mode).toBe("multiple");
      // A rollback can read it back, retired metadata kind and all.
      expect(() =>
        parseMultipleSessionRecord(result.backup?.session)
      ).not.toThrow();
      // Restore keeps the kept stations and the old master; without it,
      // Node is rebuilt from the Starter patch, one empty slot.
      expect(result.nodeStations).toEqual(
        restoreStateOnLoad ? ["src-kexp", "src-rg_live"] : ["src-station"]
      );
      expect(result.masterVolume).toBe(restoreStateOnLoad ? 0.3 : 1);
      expect(result.laneVolumes).toEqual(restoreStateOnLoad ? [0.9, 1] : []);
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

  test("a store too full for Node keeps Multiple and settles", async () => {
    // The Node record is larger than Multiple's, so it cannot be written,
    // and the rolled-back delete must not run the step again and again.
    const result = await runRawStorageScenario({
      crossTab: false,
      quotaHeadroom: 50,
      restoreStateOnLoad: true,
    });

    expect(result.refusedSessionWrites).toBeLessThan(20);
    expect(result.storedSessionIds).toEqual(["multiple"]);
    expect(result.backup).toBeNull();
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
