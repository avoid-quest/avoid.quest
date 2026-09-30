import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { buildNodeSessionFromTemplate } from "@/lib/node-graph/templates";
import {
  getPlaybackSession,
  parsePlaybackSessionRecord,
  playbackSessionsCollection,
} from "../playback-sessions";
import { radiosCollection } from "../radios";
import { sessionRadiosCollection } from "../session-radios";
import { getSettings, settingsCollection } from "../settings";
import {
  buildNodeSessionFromMultipleRecord,
  MULTIPLE_BACKUP_STORAGE_KEY,
  migrateMultipleSession,
} from "./multiple-to-node";
import {
  buildMultipleSessionFromNodeSession,
  migrateNodeToMultiple,
  readMultipleBackup,
} from "./node-to-multiple";

const SETTINGS_ID = "app-settings";

function radio(id: string): Radio {
  return {
    id,
    name: id.toUpperCase(),
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

function createMemoryStorage() {
  const state = new Map<string, string>();
  return {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
  };
}

async function reset() {
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
  ] as const) {
    for (const key of Array.from(collection.state.keys())) {
      collection.delete(key as never);
    }
  }
}

beforeEach(reset);
afterEach(reset);

function insertNodeSession() {
  playbackSessionsCollection.insert(
    buildNodeSessionFromTemplate("start-from-multiple", {
      levels: (station) =>
        station.id === "kexp" ? { muted: true, volume: 0.4 } : undefined,
      masterVolume: 0.6,
      saved: [
        { ...radio("kexp"), enabled: true, order: 0 },
        { ...radio("nts"), enabled: true, order: 1 },
      ],
    })
  );
}

describe("buildMultipleSessionFromNodeSession", () => {
  test("keeps each Station lane's order and level, once per station", () => {
    const node = buildNodeSessionFromTemplate("start-from-multiple", {
      masterVolume: 0.5,
      session: [radio("rg_a"), radio("rg_b")],
    });
    // A second Station on the same radio.
    const [duplicate] = node.channels;
    if (!duplicate) {
      throw new Error("Expected a lane");
    }
    node.channels.push({ ...duplicate, id: "n:src-rg_a-2", order: 2 });

    const multiple = parsePlaybackSessionRecord(
      buildMultipleSessionFromNodeSession(node)
    );

    expect(multiple.id).toBe("multiple");
    expect(multiple.masterVolume).toBe(0.5);
    expect(multiple.channels.map((channel) => channel.id)).toEqual([
      "multi:rg_a",
      "multi:rg_b",
    ]);
    expect(multiple.channels.map((channel) => channel.order)).toEqual([0, 1]);
    expect(
      multiple.channels.every((channel) => channel.role === "multiple")
    ).toBe(true);
  });
});

describe("migrateNodeToMultiple", () => {
  test("rebuilds a valid multiple record from Station lanes and rewrites the mode", () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "node", restoreStateOnLoad: true },
    });
    insertNodeSession();

    migrateNodeToMultiple({
      sessions: playbackSessionsCollection,
      settings: settingsCollection,
      storage: createMemoryStorage(),
    });

    const multiple = getPlaybackSession("multiple");
    expect(() => parsePlaybackSessionRecord(multiple)).not.toThrow();
    expect(
      multiple?.channels.map(({ id, muted, volume }) => ({ id, muted, volume }))
    ).toEqual([
      { id: "multi:kexp", muted: true, volume: 0.4 },
      { id: "multi:nts", muted: false, volume: 1 },
    ]);
    expect(multiple?.masterVolume).toBe(0.6);
    expect(getSettings()?.player.mode).toBe("multiple");
    // The patch stays for a later roll-forward.
    expect(getPlaybackSession("node")).toBeDefined();
  });

  test("rebuilds from the backup when the patch has no lanes", () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "multiple", restoreStateOnLoad: true },
    });
    radiosCollection.insert({
      ...radio("kexp"),
      enabled: true,
      id: "kexp",
      isSystem: false,
      order: 0,
    });
    const stored = {
      channels: [
        {
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
          id: "multi:kexp",
          muted: false,
          pan: 0,
          radio: radio("kexp"),
          role: "multiple",
          speed: 1,
          volume: 0.25,
        },
      ],
      id: "multiple",
      masterVolume: 0.7,
    };
    playbackSessionsCollection.insert(parsePlaybackSessionRecord(stored));
    const storage = createMemoryStorage();
    // Forward, then empty the patch, then back.
    migrateMultipleSession(
      {
        radios: radiosCollection,
        sessionRadios: sessionRadiosCollection,
        sessions: playbackSessionsCollection,
      },
      storage
    );
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = "node";
    });
    playbackSessionsCollection.update("node", (draft) => {
      draft.channels = [];
    });

    migrateNodeToMultiple({
      sessions: playbackSessionsCollection,
      settings: settingsCollection,
      storage,
    });

    const multiple = getPlaybackSession("multiple");
    expect(multiple?.masterVolume).toBe(0.7);
    expect(
      multiple?.channels.map(({ id, volume }) => ({ id, volume }))
    ).toEqual([{ id: "multi:kexp", volume: 0.25 }]);
    expect(readMultipleBackup(storage)?.mode).toBe("multiple");
    expect(getSettings()?.player.mode).toBe("multiple");
  });

  test("round-trips through the forward migration", () => {
    insertNodeSession();
    migrateNodeToMultiple({
      sessions: playbackSessionsCollection,
      settings: settingsCollection,
      storage: null,
    });
    const multiple = getPlaybackSession("multiple");

    const forward = buildNodeSessionFromMultipleRecord(multiple, () => true);

    expect(forward.graph?.nodes.map((node) => node.id)).toEqual([
      "src-kexp",
      "src-nts",
      "speakers",
    ]);
    expect(forward.masterVolume).toBe(0.6);
    expect(
      forward.channels.map(({ muted, volume }) => ({ muted, volume }))
    ).toEqual([
      { muted: true, volume: 0.4 },
      { muted: false, volume: 1 },
    ]);
  });

  test("leaves an existing multiple record and other modes alone", () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "dj", restoreStateOnLoad: true },
    });
    insertNodeSession();
    migrateNodeToMultiple({
      sessions: playbackSessionsCollection,
      settings: settingsCollection,
      storage: null,
    });
    const first = getPlaybackSession("multiple");
    playbackSessionsCollection.update("node", (draft) => {
      draft.masterVolume = 0.1;
    });

    migrateNodeToMultiple({
      sessions: playbackSessionsCollection,
      settings: settingsCollection,
      storage: null,
    });

    expect(getPlaybackSession("multiple")).toEqual(first);
    expect(getSettings()?.player.mode).toBe("dj");
  });

  test("ignores an unreadable backup", () => {
    const storage = createMemoryStorage();
    storage.setItem(MULTIPLE_BACKUP_STORAGE_KEY, "{not json");
    expect(readMultipleBackup(storage)).toBeNull();
    expect(readMultipleBackup(null)).toBeNull();
  });
});
