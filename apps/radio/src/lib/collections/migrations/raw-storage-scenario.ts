/**
 * Raw-storage Migration Scenario (test support)
 *
 * The collections are module singletons that pick their storage when first
 * imported, and bun shares one module registry across test files. So a test
 * that must seed raw localStorage before the collections load runs this file
 * in a fresh bun process: `runRawStorageScenario` spawns it, and the script
 * half seeds the stored records an older release wrote, runs the app's init,
 * performs later settings and session updates, and prints what happened.
 */

import { dirname, resolve } from "node:path";

export type RawStorageScenarioOptions = {
  restoreStateOnLoad: boolean;
  /** After init, sync a "multiple" record in the way another tab would. */
  crossTab: boolean;
  /**
   * Seed settings that are stale elsewhere too, so any update of them fails
   * validation. Init must still finish.
   */
  staleSettings?: boolean;
  /**
   * Once the older release's records are seeded, localStorage holds only
   * this many more characters, as a store near its quota does.
   */
  quotaHeadroom?: number;
};

export type RawStorageScenarioResult = {
  /** Errors thrown by init or the later updates, as `name: message`. */
  errors: string[];
  mode: string | undefined;
  sessionIds: string[];
  nodeStations: string[];
  masterVolume: number | undefined;
  laneVolumes: number[];
  backup: { mode: string | null; session: unknown } | null;
  crossTabNodeUnchanged: boolean | null;
  /** Whether the synced "multiple" record reached the collection at all. */
  crossTabMultipleSynced: boolean | null;
  /** Session ids and mode as written to localStorage, not as held in memory. */
  storedSessionIds: string[];
  storedMode: unknown;
  /** Writes of the playback sessions that localStorage refused. */
  refusedSessionWrites: number;
};

const RESULT_PREFIX = "RAW_STORAGE_SCENARIO:";
const SESSIONS_KEY = "radio-app-playback-sessions";
const BACKUP_KEY = "radio-app-multiple-backup";

/** A scenario that runs longer has hung, as a page that never yields. */
const SCENARIO_TIMEOUT_MS = 4000;

export async function runRawStorageScenario(
  options: RawStorageScenarioOptions
): Promise<RawStorageScenarioResult> {
  const child = Bun.spawn(
    [process.execPath, import.meta.path, JSON.stringify(options)],
    {
      cwd: resolve(dirname(import.meta.path), "../../../.."),
      killSignal: "SIGKILL",
      stderr: "pipe",
      stdout: "pipe",
      timeout: SCENARIO_TIMEOUT_MS,
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const line = stdout
    .split("\n")
    .find((entry) => entry.startsWith(RESULT_PREFIX));
  if (exitCode !== 0 || !line) {
    throw new Error(`Scenario exited ${exitCode}:\n${stdout}\n${stderr}`);
  }
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

type MemoryStorage = Storage & {
  /** Refuses a write that would hold more than `headroom` more characters. */
  limitTo: (headroom: number) => void;
  /** Writes refused per key. */
  refused: Map<string, number>;
};

function createMemoryStorage(): MemoryStorage {
  const state = new Map<string, string>();
  const refused = new Map<string, number>();
  let quota = Number.POSITIVE_INFINITY;
  const size = () =>
    [...state].reduce(
      (total, [key, value]) => total + key.length + value.length,
      0
    );
  return {
    clear: () => state.clear(),
    getItem: (key) => state.get(key) ?? null,
    key: (index) => [...state.keys()][index] ?? null,
    get length() {
      return state.size;
    },
    limitTo: (headroom) => {
      quota = size() + headroom;
    },
    refused,
    removeItem: (key) => {
      state.delete(key);
    },
    setItem: (key, value) => {
      const previous = state.get(key);
      const next =
        size() -
        (previous === undefined ? 0 : key.length + previous.length) +
        key.length +
        value.length;
      if (next > quota) {
        refused.set(key, (refused.get(key) ?? 0) + 1);
        throw new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError"
        );
      }
      state.set(key, value);
    },
  };
}

/** A stored collection value, keyed the way TanStack DB's local storage is. */
function storedRecords(
  records: ReadonlyArray<{ id: string } & Record<string, unknown>>
): string {
  return JSON.stringify(
    Object.fromEntries(
      records.map((data, index) => [
        `s:${data.id}`,
        { data, versionKey: `legacy-${index}` },
      ])
    )
  );
}

const station = (id: string) => ({
  id,
  name: id.toUpperCase(),
  streamUrl: `https://radio.example/${id}.mp3`,
});

/**
 * A channel as an older release stored it: no `order`, `autoplay` or cue, and
 * KEXP's snapshot holds a metadata kind the current schema no longer knows.
 */
function legacyChannel(id: string, volume: number) {
  return {
    channelFilter: 0,
    effects: [],
    effectsDryWet: 1,
    filter: {
      enabled: false,
      frequency: 1000,
      gain: 0,
      Q: 1,
      type: "lowpass",
    },
    id: `multi:${id}`,
    muted: false,
    pan: 0,
    radio:
      id === "kexp"
        ? { ...station(id), metadataConfig: { kind: "retired-provider" } }
        : station(id),
    role: "multiple",
    speed: 1,
    volume,
  };
}

/** The "multiple" record an older release left, before tempo existed. */
const legacyMultipleRecord = (masterVolume: number) => ({
  activeChannelId: null,
  channels: [
    legacyChannel("kexp", 0.9),
    legacyChannel("rg_gone", 0.5),
    legacyChannel("rg_live", 1),
  ],
  crossfadePosition: 0.5,
  headphoneVolume: 1,
  id: "multiple",
  masterVolume,
});

async function settle(): Promise<void> {
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
}

async function runScenario({
  crossTab,
  quotaHeadroom,
  restoreStateOnLoad,
  staleSettings = false,
}: RawStorageScenarioOptions): Promise<RawStorageScenarioResult> {
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const window = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage,
  });
  for (const [key, value] of Object.entries({
    localStorage,
    sessionStorage,
    window,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  localStorage.setItem(
    "radio-app-settings",
    storedRecords([
      {
        id: "app-settings",
        player: { mode: "multiple", restoreStateOnLoad },
        ...(staleSettings ? { audio: { delay: { mainDelayMs: 9000 } } } : {}),
      },
    ])
  );
  localStorage.setItem(
    "radio-app-radios",
    storedRecords([
      { ...station("kexp"), enabled: true, isSystem: false, order: 0 },
    ])
  );
  localStorage.setItem(
    SESSIONS_KEY,
    storedRecords([legacyMultipleRecord(0.3)])
  );
  if (quotaHeadroom !== undefined) {
    localStorage.limitTo(quotaHeadroom);
  }

  const errors: string[] = [];
  const attempt = (run: () => void) => {
    try {
      run();
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      );
    }
  };

  const collections = await import("../index");
  collections.addSessionRadio(station("rg_live"));
  await collections.initializeCollections().catch((error: unknown) => {
    errors.push(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
  });
  const { playbackSessionsCollection, getPlaybackSession } = collections;

  const node = getPlaybackSession("node");
  const nodeStations =
    node?.graph?.nodes
      .filter((entry) => entry.type === "station")
      .map((entry) => entry.id) ?? [];
  const masterVolume = node?.masterVolume;

  // Later updates validate the whole merged record.
  attempt(() => collections.setRestoreStateOnLoad(restoreStateOnLoad));
  attempt(() => collections.updatePlayerSettings(() => ({ mode: "node" })));
  attempt(() =>
    collections.updatePlaybackChannel("node", "n:src-kexp", (draft) => {
      draft.volume = 0.9;
    })
  );
  for (const id of ["single", "node", "dj"] as const) {
    attempt(() =>
      collections.updatePlaybackSession(id, (draft) => {
        draft.masterVolume = draft.masterVolume ?? 1;
      })
    );
  }

  let crossTabNodeUnchanged: boolean | null = null;
  let crossTabMultipleSynced: boolean | null = null;
  if (crossTab) {
    crossTabMultipleSynced = false;
    const subscription = playbackSessionsCollection.subscribeChanges(
      (changes) => {
        crossTabMultipleSynced ||= changes.some(
          // Legacy "multiple" rows arrive from other tabs outside the declared key type.
          (change) =>
            (change.key as string) === "multiple" && change.type === "insert"
        );
      }
    );
    const before = JSON.stringify(getPlaybackSession("node"));
    const stored = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "{}");
    stored["s:multiple"] = {
      data: legacyMultipleRecord(0.1),
      versionKey: "other-tab",
    };
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(stored));
    window.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: SESSIONS_KEY,
        storageArea: localStorage,
      })
    );
    await settle();
    subscription.unsubscribe();
    crossTabNodeUnchanged =
      JSON.stringify(getPlaybackSession("node")) === before;
  }
  await settle();

  const backup = localStorage.getItem(BACKUP_KEY);
  const storedSessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "{}");
  const storedSettings = JSON.parse(
    localStorage.getItem("radio-app-settings") ?? "{}"
  );
  return {
    backup: backup ? JSON.parse(backup) : null,
    crossTabMultipleSynced,
    crossTabNodeUnchanged,
    errors,
    laneVolumes:
      getPlaybackSession("node")?.channels.map((channel) => channel.volume) ??
      [],
    masterVolume,
    mode: collections.getSettings()?.player.mode,
    nodeStations,
    refusedSessionWrites: localStorage.refused.get(SESSIONS_KEY) ?? 0,
    sessionIds: [...playbackSessionsCollection.state.keys()].sort(),
    storedMode: storedSettings["s:app-settings"]?.data?.player?.mode,
    storedSessionIds: Object.values(storedSessions)
      .map((entry) => (entry as { data?: { id?: string } }).data?.id ?? "")
      .sort(),
  };
}

if (import.meta.main) {
  const options = JSON.parse(process.argv[2] ?? "{}");
  const result = await runScenario(options);
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
  process.exit(0);
}
