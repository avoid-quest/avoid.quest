/**
 * Legacy Records
 *
 * Multiple is gone, so the schemas no longer list the `"multiple"` session
 * id, its channel role or its player mode. A record another release stored
 * with them still loads, because stored records load unvalidated, and the
 * migrations read and delete it by the retired key below.
 *
 * Writing such a record goes the same way a load does: through the
 * collection's sync, so the schema is not consulted and the record reaches
 * storage exactly as given. The reverse migration writes records for an
 * older release like this, and tests seed the records an older release left.
 */

import type { PendingMutation } from "@tanstack/react-db";
import type { PlaybackSessionId } from "../playback-sessions";

/**
 * The retired session id. It is typed as a session id only so a stored
 * record can be read and deleted by it; nothing inserts under it.
 */
export const LEGACY_MULTIPLE_SESSION_ID =
  "multiple" as unknown as PlaybackSessionId;

type LegacyRecord = { id: string } & Record<string, unknown>;

/** A local-storage collection, whose sync can take unvalidated writes. */
type LegacyWritableCollection = {
  id: string;
  state: ReadonlyMap<unknown, unknown>;
  utils: {
    acceptMutations: (transaction: {
      mutations: PendingMutation<Record<string, unknown>>[];
    }) => void;
  };
};

/**
 * Inserts `record`, or replaces the record stored under its id, without
 * validating it. For records the current schemas reject; everything else
 * goes through `insert` and `update`.
 *
 * Like any synced write, it lands once the collection's pending mutations
 * have persisted, and a delete of the same key must have persisted first.
 */
export function writeLegacyRecord(
  collection: LegacyWritableCollection,
  record: LegacyRecord
): void {
  const original = collection.state.get(record.id);
  const mutation = {
    collection,
    key: record.id,
    // A record read back from the collection carries virtual `$` fields.
    modified: Object.fromEntries(
      Object.entries(record).filter(([key]) => !key.startsWith("$"))
    ),
    original: original ?? {},
    type: original === undefined ? "insert" : "update",
  };
  collection.utils.acceptMutations({
    mutations: [
      mutation as unknown as PendingMutation<Record<string, unknown>>,
    ],
  });
}
