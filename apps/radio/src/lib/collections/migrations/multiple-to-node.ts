/**
 * Multiple → Node Migration (session step)
 *
 * Node replaced Multiple. A stored `"multiple"` playback session becomes a
 * `"node"` patch: one Station per kept channel, in Multiple's order and at
 * its volume, each wired to a Speakers node whose gain is the old master.
 *
 * Stored records load unvalidated, while any update of a stale one throws, so
 * this runs first in `initializePlaybackSessions`, before anything updates
 * the collection, and again whenever another tab writes a `"multiple"`
 * record back. It is idempotent: once `"node"` exists it only deletes
 * `"multiple"`. The settings step is `migrateLegacyPlayerMode` in
 * `collections/settings.ts`.
 */

import type { Radio } from "@/lib/audio/playback/types";
import { isSessionRadio } from "@/lib/collections/session-radios";
import type { NodeGraph } from "@/lib/node-graph/schema";
import {
  buildNodeSessionFromGraph,
  buildStationPatch,
  type StationSeed,
} from "@/lib/node-graph/templates";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";
import {
  normalizeRadio,
  type PlaybackSessionRecord,
  type playbackSessionsCollection,
} from "../playback-sessions";
import type { radiosCollection } from "../radios";
import type { sessionRadiosCollection } from "../session-radios";
import {
  getReplacedPlayerMode,
  getSettings,
  migrateLegacyPlayerMode,
  type settingsCollection,
} from "../settings";
import { LEGACY_MULTIPLE_SESSION_ID } from "./legacy-records";

/** localStorage key holding the pre-migration Multiple record, written once. */
export const MULTIPLE_BACKUP_STORAGE_KEY = "radio-app-multiple-backup";

export type MultipleBackup = {
  /** The player mode stored before the migration rewrote it. */
  mode: string | null;
  /** The `"multiple"` session record exactly as it was stored. */
  session: unknown;
  createdAt: number;
};

type BackupStorage = Pick<Storage, "getItem" | "setItem">;

export type MultipleToNodeCollections = {
  sessions: typeof playbackSessionsCollection;
  radios: typeof radiosCollection;
  sessionRadios: typeof sessionRadiosCollection;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getBackupStorage(): BackupStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    // Storage access can throw when the browser blocks it.
    return null;
  }
}

function clampUnit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/**
 * A channel radio as the session schema accepts it, or null when it is not a
 * playable station. A snapshot from an older release can hold a field the
 * schema now rejects (a retired metadata kind, say); the station then keeps
 * its id, name and stream, so the insert cannot fail on it.
 */
function readRadio(value: unknown): Radio | null {
  if (
    !(
      isRecord(value) &&
      typeof value.name === "string" &&
      typeof value.streamUrl === "string"
    )
  ) {
    return null;
  }
  const radio = normalizeRadio(value);
  if (radio) {
    return radio;
  }
  const id =
    typeof value.id === "string" || typeof value.id === "number"
      ? value.id
      : undefined;
  return {
    ...(id === undefined ? {} : { id }),
    name: value.name,
    streamUrl: value.streamUrl,
  };
}

/**
 * The Multiple record as a node patch. The record is read leniently, because
 * it was stored by an older release and never validated on load. Channels
 * whose radio `isKept` rejects are dropped; the rest keep their order,
 * volume and mute.
 */
export function buildNodeGraphFromMultipleRecord(
  record: unknown,
  isKept: (radio: Radio) => boolean
): NodeGraph {
  const channels =
    isRecord(record) && Array.isArray(record.channels)
      ? record.channels.filter(isRecord)
      : [];
  const seeds = channels
    .map((channel, index) => ({
      muted: channel.muted === true,
      order: typeof channel.order === "number" ? channel.order : index,
      radio: readRadio(channel.radio),
      volume: clampUnit(channel.volume, 1),
    }))
    .filter(
      (seed): seed is typeof seed & { radio: Radio } =>
        seed.radio !== null && isKept(seed.radio)
    )
    // A stable sort keeps stored order for equal `order` values.
    .sort((a, b) => a.order - b.order)
    .map(({ muted, radio, volume }): StationSeed => ({ muted, radio, volume }));
  return buildStationPatch(seeds);
}

/** The `"node"` session a stored Multiple record migrates to. */
export function buildNodeSessionFromMultipleRecord(
  record: unknown,
  isKept: (radio: Radio) => boolean
): PlaybackSessionRecord {
  const masterVolume =
    isRecord(record) &&
    typeof record.masterVolume === "number" &&
    Number.isFinite(record.masterVolume)
      ? Math.max(0, record.masterVolume)
      : 1;
  return buildNodeSessionFromGraph(
    buildNodeGraphFromMultipleRecord(record, isKept),
    masterVolume
  );
}

/**
 * Keeps a radio that is among `saved`, or a session radio still among
 * `session`, this tab's sessionStorage (the test Multiple's prune used).
 */
export function createKeptRadioTest(
  saved: Iterable<Pick<Radio, "id">>,
  session: Iterable<Pick<Radio, "id">>
): (radio: Radio) => boolean {
  const savedIds = new Set(Array.from(saved, (radio) => String(radio.id)));
  const sessionIds = new Set(Array.from(session, (radio) => String(radio.id)));
  return (radio) => {
    if (radio.id === undefined) {
      return false;
    }
    const id = String(radio.id);
    return isSessionRadio(radio) ? sessionIds.has(id) : savedIds.has(id);
  };
}

/** A collection value without the virtual `$synced`, `$key`… fields. */
function withoutVirtualFields(record: unknown): unknown {
  return isRecord(record)
    ? Object.fromEntries(
        Object.entries(record).filter(([key]) => !key.startsWith("$"))
      )
    : record;
}

/** Writes the backup unless one exists; a failing storage is not fatal. */
function backupMultipleRecord(
  session: unknown,
  mode: string | null,
  storage: BackupStorage | null
): void {
  if (!storage) {
    return;
  }
  try {
    if (storage.getItem(MULTIPLE_BACKUP_STORAGE_KEY) !== null) {
      return;
    }
    const backup: MultipleBackup = {
      createdAt: Date.now(),
      mode,
      session: withoutVirtualFields(session),
    };
    storage.setItem(MULTIPLE_BACKUP_STORAGE_KEY, JSON.stringify(backup));
  } catch (error) {
    console.warn(
      "[multiple-to-node] Could not back up the Multiple session",
      error
    );
  }
}

/**
 * The session step. Idempotent: with no `"multiple"` record it does nothing,
 * and with a `"node"` record already stored it only deletes `"multiple"`.
 */
export function migrateMultipleSession(
  collections: MultipleToNodeCollections,
  storage: BackupStorage | null = getBackupStorage()
): void {
  const { sessions } = collections;
  const multiple: unknown = sessions.state.get(LEGACY_MULTIPLE_SESSION_ID);
  if (multiple === undefined) {
    return;
  }
  if (!sessions.state.has("node")) {
    const mode = getReplacedPlayerMode() ?? getSettings()?.player.mode ?? null;
    backupMultipleRecord(multiple, mode, storage);
    try {
      // The insert validates the new record.
      sessions.insert(
        buildNodeSessionFromMultipleRecord(
          multiple,
          createKeptRadioTest(
            collections.radios.state.values(),
            collections.sessionRadios.state.values()
          )
        )
      );
    } catch (error) {
      // Never block startup on an old record: the backup holds it, and init
      // builds Node from "Start from Multiple" when "node" is missing.
      console.warn(
        "[multiple-to-node] Could not migrate the Multiple session",
        error
      );
    }
  }
  // Delete does not validate, so a stale record still goes.
  sessions.delete(LEGACY_MULTIPLE_SESSION_ID);
}

type LegacyWriteListeners = MultipleToNodeCollections & {
  settings: typeof settingsCollection;
  /** Moves the running mode; defaults to the mode lifecycle's requestMode. */
  requestMode?: (mode: string) => Promise<void>;
};

async function requestModeFromLifecycle(mode: string): Promise<void> {
  const { modeLifecycleRequests } = await import(
    "@/lib/mode-lifecycle-requests"
  );
  await modeLifecycleRequests.requestMode(mode);
}

/**
 * Cross-tab listeners. A tab still running Multiple can write a `"multiple"`
 * session or mode back through storage events; the session listener re-runs
 * the session step, and the settings listener rewrites the mode and moves
 * this tab to it. Returns the unsubscribe.
 */
export function watchLegacyMultipleWrites({
  requestMode = requestModeFromLifecycle,
  settings,
  ...collections
}: LegacyWriteListeners): () => void {
  const sessionSubscription = collections.sessions.subscribeChanges(
    (changes) => {
      if (
        changes.some(
          (change) =>
            change.key === LEGACY_MULTIPLE_SESSION_ID &&
            change.type !== "delete"
        )
      ) {
        // Mutating from inside the change callback would re-enter it.
        queueMicrotask(() => migrateMultipleSession(collections));
      }
    }
  );
  const settingsSubscription = settings.subscribeChanges(() => {
    const mode: unknown = getSettings()?.player.mode;
    if (mode === undefined || normalizePlayerMode(mode) === mode) {
      return;
    }
    queueMicrotask(() => {
      migrateLegacyPlayerMode();
      requestMode(normalizePlayerMode(mode)).catch((error) => {
        console.warn("[multiple-to-node] Could not follow the mode", error);
      });
    });
  });
  return () => {
    sessionSubscription.unsubscribe();
    settingsSubscription.unsubscribe();
  };
}
