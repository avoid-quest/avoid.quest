/**
 * Node → Multiple Migration (rollback only)
 *
 * Rolling Node back is not a code revert: the forward migration rewrote the
 * stored mode to "node" and deleted the `"multiple"` record, which code from
 * before Node could not read back. This rebuilds a `"multiple"` record from
 * the node session's Station lanes, or from the backup the forward migration
 * wrote, and rewrites the mode. It is tested but not wired into init; a
 * rollback is a forward change that calls `migrateNodeToMultiple` there.
 * The node record stays, so the patch survives a later roll-forward.
 */

import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/routing/effect-tree";
import type { Radio } from "@/lib/audio/playback/types";
import {
  createDefaultChannel,
  getMultipleChannelId,
  type PlaybackSessionRecord,
  parsePlaybackSessionRecord,
  type playbackSessionsCollection,
} from "../playback-sessions";
import type { settingsCollection } from "../settings";
import {
  MULTIPLE_BACKUP_STORAGE_KEY,
  type MultipleBackup,
} from "./multiple-to-node";

const SETTINGS_ID = "app-settings";

type BackupStorage = Pick<Storage, "getItem">;

/**
 * A `"multiple"` record with one channel per Station lane, in lane order and
 * at the lane's volume and mute. A station on two lanes keeps its first.
 */
export function buildMultipleSessionFromNodeSession(
  node: Pick<PlaybackSessionRecord, "channels" | "masterVolume">
): PlaybackSessionRecord {
  const channelIds = new Set<string>();
  const channels = [...node.channels]
    .sort((a, b) => a.order - b.order)
    .flatMap((lane) => {
      if (!lane.radio) {
        return [];
      }
      const radio = lane.radio as Radio;
      const id = getMultipleChannelId(radio);
      if (channelIds.has(id)) {
        return [];
      }
      channelIds.add(id);
      return [
        {
          ...createDefaultChannel(id, "multiple", channelIds.size - 1),
          muted: lane.muted,
          radio: lane.radio,
          volume: lane.volume,
        },
      ];
    });
  return {
    activeChannelId: null,
    channels,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id: "multiple",
    masterVolume: node.masterVolume,
    tempo: DEFAULT_EFFECT_TEMPO,
  };
}

/** The forward migration's backup, or null when absent or unreadable. */
export function readMultipleBackup(
  storage: BackupStorage | null
): { mode: string | null; session: PlaybackSessionRecord } | null {
  try {
    const raw = storage?.getItem(MULTIPLE_BACKUP_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const backup = JSON.parse(raw) as Partial<MultipleBackup>;
    return {
      mode: typeof backup.mode === "string" ? backup.mode : null,
      session: parsePlaybackSessionRecord(backup.session),
    };
  } catch {
    return null;
  }
}

type NodeToMultipleOptions = {
  sessions: typeof playbackSessionsCollection;
  settings: typeof settingsCollection;
  storage?: BackupStorage | null;
};

/**
 * Inserts a `"multiple"` record, from the Station lanes when the node
 * session has any, else from the backup, and moves a "node" mode back to
 * "multiple". An existing `"multiple"` record is left alone. Idempotent.
 */
export function migrateNodeToMultiple({
  sessions,
  settings,
  storage = typeof globalThis.localStorage === "undefined"
    ? null
    : globalThis.localStorage,
}: NodeToMultipleOptions): void {
  if (!sessions.state.has("multiple")) {
    const node = sessions.state.get("node");
    const multiple =
      node && node.channels.length > 0
        ? buildMultipleSessionFromNodeSession(node)
        : (readMultipleBackup(storage)?.session ??
          buildMultipleSessionFromNodeSession({
            channels: [],
            masterVolume: node?.masterVolume ?? 1,
          }));
    sessions.insert({ ...multiple, id: "multiple" });
  }
  if (settings.state.get(SETTINGS_ID)?.player.mode === "node") {
    settings.update(SETTINGS_ID, (draft) => {
      draft.player.mode = "multiple";
    });
  }
}
