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
import { laneChannelId } from "@/lib/node-graph/compile";
import {
  createDefaultChannel,
  type PlaybackChannelRecord,
  type PlaybackSessionRecord,
  parsePlaybackSessionRecord,
  type playbackSessionsCollection,
} from "../playback-sessions";
import type { settingsCollection } from "../settings";
import {
  LEGACY_MULTIPLE_SESSION_ID,
  writeLegacyRecord,
} from "./legacy-records";
import {
  MULTIPLE_BACKUP_STORAGE_KEY,
  type MultipleBackup,
  readLegacyRadio,
} from "./multiple-to-node";

const SETTINGS_ID = "app-settings";

type BackupStorage = Pick<Storage, "getItem">;

/** A channel as Multiple stored it. */
export type MultipleChannelRecord = Omit<PlaybackChannelRecord, "role"> & {
  role: "multiple";
};

/** A `"multiple"` session as the release before Node stored it. */
export type MultipleSessionRecord = Omit<
  PlaybackSessionRecord,
  "channels" | "graph" | "id"
> & {
  channels: MultipleChannelRecord[];
  id: "multiple";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Multiple's channel id for a station. */
function getMultipleChannelId(radio: Pick<Radio, "id" | "name">): string {
  return `multi:${String(radio.id ?? radio.name)}`;
}

/**
 * Parses a `"multiple"` session with the schema the release before Node
 * used: the current one, whose ids and roles no longer list "multiple".
 * A station snapshot that schema now rejects keeps its id, name and stream,
 * as in the forward migration, so a backup of a record that migration read
 * can be read back.
 * Throws when `value` is not such a session.
 */
export function parseMultipleSessionRecord(
  value: unknown
): MultipleSessionRecord {
  if (!(isRecord(value) && value.id === "multiple")) {
    throw new Error("Expected a multiple session");
  }
  const channels = Array.isArray(value.channels) ? value.channels : [];
  const { graph: _graph, ...session } = parsePlaybackSessionRecord({
    ...value,
    channels: channels.map((channel: unknown) =>
      isRecord(channel) && channel.role === "multiple"
        ? {
            ...channel,
            radio: readLegacyRadio(channel.radio) ?? channel.radio,
            role: "node",
          }
        : channel
    ),
    id: "node",
  });
  return {
    ...session,
    channels: session.channels.map((channel) => ({
      ...channel,
      role: "multiple",
    })),
    id: "multiple",
  };
}

/**
 * A `"multiple"` record with one channel per Station lane, in lane order and
 * at the lane's volume and mute. A station on two lanes keeps its first.
 * Track, File and Audio input lanes have no Multiple channel; without a
 * graph no lane is known to be a Station's.
 */
export function buildMultipleSessionFromNodeSession(
  node: Pick<PlaybackSessionRecord, "channels" | "graph" | "masterVolume">
): MultipleSessionRecord {
  const stationLaneIds = new Set(
    (node.graph?.nodes ?? [])
      .filter((graphNode) => graphNode.type === "station")
      .map((graphNode) => laneChannelId(graphNode.id))
  );
  const channelIds = new Set<string>();
  const channels = [...node.channels]
    .sort((a, b) => a.order - b.order)
    .flatMap((lane): MultipleChannelRecord[] => {
      if (!(lane.radio && stationLaneIds.has(lane.id))) {
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
          ...createDefaultChannel(id, "node", channelIds.size - 1),
          muted: lane.muted,
          radio: lane.radio,
          role: "multiple",
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
): { mode: string | null; session: MultipleSessionRecord } | null {
  try {
    const raw = storage?.getItem(MULTIPLE_BACKUP_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const backup = JSON.parse(raw) as Partial<MultipleBackup>;
    return {
      mode: typeof backup.mode === "string" ? backup.mode : null,
      session: parseMultipleSessionRecord(backup.session),
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
  // The current schemas reject both records, so they are written unvalidated.
  if (!sessions.state.has(LEGACY_MULTIPLE_SESSION_ID)) {
    const node = sessions.state.get("node");
    const fromLanes = buildMultipleSessionFromNodeSession({
      channels: node?.channels ?? [],
      graph: node?.graph,
      masterVolume: node?.masterVolume ?? 1,
    });
    const multiple =
      fromLanes.channels.length > 0
        ? fromLanes
        : (readMultipleBackup(storage)?.session ?? fromLanes);
    writeLegacyRecord(sessions, { ...multiple, id: "multiple" });
  }
  const current = settings.state.get(SETTINGS_ID);
  if (current?.player.mode === "node") {
    writeLegacyRecord(settings, {
      ...current,
      player: { ...current.player, mode: "multiple" },
    });
  }
}
