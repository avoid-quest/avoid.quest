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
 * `"multiple"`, and never before Node or a readable backup holds it. The
 * settings step is `migrateLegacyPlayerMode` in `collections/settings.ts`.
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
  PLAYBACK_SESSIONS_STORAGE_KEY,
  type PlaybackSessionRecord,
  type playbackSessionsCollection,
  subscribeToOtherTabStorageWrites,
} from "../playback-sessions";
import type { radiosCollection } from "../radios";
import type { sessionRadiosCollection } from "../session-radios";
import {
  getReplacedPlayerMode,
  getSettings,
  migrateLegacyPlayerMode,
  SETTINGS_STORAGE_KEY,
} from "../settings";
import { LEGACY_MULTIPLE_SESSION_ID } from "./legacy-records";
import { readMultipleBackup } from "./node-to-multiple";

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
export function readLegacyRadio(value: unknown): Radio | null {
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
      radio: readLegacyRadio(channel.radio),
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
 * Saved comes first: an imported library can keep a discovery-prefixed id.
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
    return savedIds.has(id) || (isSessionRadio(radio) && sessionIds.has(id));
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

/**
 * Whether `storage` holds a backup a rollback could read back: one whose
 * session the rollback's own parser accepts.
 */
function hasReadableBackup(storage: BackupStorage): boolean {
  return readMultipleBackup(storage) !== null;
}

/**
 * Writes the backup unless a readable one exists; a corrupt one is replaced.
 * Returns whether a readable backup is stored afterwards. A failing storage
 * is not fatal, but the caller then keeps the record.
 */
function backupMultipleRecord(
  session: unknown,
  mode: string | null,
  storage: BackupStorage | null
): boolean {
  if (!storage) {
    return false;
  }
  try {
    if (hasReadableBackup(storage)) {
      return true;
    }
    const backup: MultipleBackup = {
      createdAt: Date.now(),
      mode,
      session: withoutVirtualFields(session),
    };
    storage.setItem(MULTIPLE_BACKUP_STORAGE_KEY, JSON.stringify(backup));
    return hasReadableBackup(storage);
  } catch (error) {
    console.warn(
      "[multiple-to-node] Could not back up the Multiple session",
      error
    );
    return false;
  }
}

/**
 * The session step. Idempotent: with no `"multiple"` record it does nothing,
 * and with a `"node"` record already stored it only deletes `"multiple"`.
 * The record goes only once Node holds it or a readable backup does; until
 * then it stays, unvalidated and unused, and a later run retries.
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
  const mode = getReplacedPlayerMode() ?? getSettings()?.player.mode ?? null;
  if (sessions.state.has("node")) {
    // Another tab's write, or a record kept by a failed run: a backup
    // stored earlier still holds the first record. Without storage nothing
    // outlives this page, so there is nothing to keep it for.
    if (storage && !backupMultipleRecord(multiple, mode, storage)) {
      return;
    }
  } else {
    const backedUp = backupMultipleRecord(multiple, mode, storage);
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
      // Never block startup on an old record: init builds Node from the
      // Starter patch when "node" is missing.
      console.warn(
        "[multiple-to-node] Could not migrate the Multiple session",
        error
      );
      if (!backedUp) {
        // Nothing else holds it, so it stays for a later run.
        return;
      }
    }
  }
  // Delete does not validate, so a stale record still goes.
  sessions.delete(LEGACY_MULTIPLE_SESSION_ID);
}

type LegacyWriteListeners = MultipleToNodeCollections & {
  /** Moves the running mode; defaults to the mode lifecycle's requestMode. */
  requestMode?: (mode: string) => Promise<void>;
  /**
   * Calls a listener after another tab writes a storage key; defaults to
   * storage events.
   */
  otherTabWrites?: (storageKey: string, listener: () => void) => () => void;
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
 *
 * Only another tab's writes count. This tab's own write that fails to
 * persist (a full localStorage) rolls back and brings the legacy record
 * back; re-running the step on that would fail and roll back again, without
 * end.
 */
export function watchLegacyMultipleWrites({
  otherTabWrites = subscribeToOtherTabStorageWrites,
  requestMode = requestModeFromLifecycle,
  ...collections
}: LegacyWriteListeners): () => void {
  const stopSessions = otherTabWrites(PLAYBACK_SESSIONS_STORAGE_KEY, () =>
    migrateMultipleSession(collections)
  );
  const stopSettings = otherTabWrites(SETTINGS_STORAGE_KEY, () => {
    const mode: unknown = getSettings()?.player.mode;
    if (mode === undefined || normalizePlayerMode(mode) === mode) {
      return;
    }
    migrateLegacyPlayerMode();
    requestMode(normalizePlayerMode(mode)).catch((error) => {
      console.warn("[multiple-to-node] Could not follow the mode", error);
    });
  });
  return () => {
    stopSessions();
    stopSettings();
  };
}
