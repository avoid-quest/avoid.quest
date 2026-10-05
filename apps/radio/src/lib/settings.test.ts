import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDefaultChannel,
  getPlaybackSession,
  type PlaybackSessionId,
  playbackSessionsCollection,
  radiosCollection,
  sessionRadiosCollection,
  settingsCollection,
} from "./collections";
import {
  LEGACY_MULTIPLE_SESSION_ID,
  writeLegacyRecord,
} from "./collections/migrations/legacy-records";
import { stopLegacyMultipleListeners } from "./collections/playback-sessions";
import { resetAllSettings } from "./settings";

async function clearCollections() {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
  ]);
  for (const key of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(key);
  }
  for (const key of Array.from(radiosCollection.state.keys())) {
    radiosCollection.delete(key);
  }
  for (const key of Array.from(sessionRadiosCollection.state.keys())) {
    sessionRadiosCollection.delete(key);
  }
  for (const key of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(key);
  }
}

function insertStaleSession(id: PlaybackSessionId) {
  playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [
      {
        ...createDefaultChannel(`${id}:stale`, "node", 0),
        radio: {
          id: "stale",
          name: "Stale FM",
          streamUrl: "https://radio.example/stale.mp3",
        },
      },
    ],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id,
    masterVolume: 0.2,
  });
}

beforeEach(clearCollections);
afterEach(async () => {
  stopLegacyMultipleListeners();
  await clearCollections();
});

describe("resetAllSettings", () => {
  test("deletes the single, node, dj and multiple sessions", async () => {
    settingsCollection.insert({
      id: "app-settings",
      player: { mode: "node", restoreStateOnLoad: true },
    });
    for (const id of ["single", "node", "dj"] as const) {
      insertStaleSession(id);
    }
    // A Multiple record as the release before Node left it.
    writeLegacyRecord(playbackSessionsCollection, {
      activeChannelId: null,
      channels: [],
      id: "multiple",
      masterVolume: 0.2,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      playbackSessionsCollection.state.has(LEGACY_MULTIPLE_SESSION_ID)
    ).toBe(true);

    await resetAllSettings();

    // Multiple is not rebuilt: Node replaced it.
    expect(
      playbackSessionsCollection.state.has(LEGACY_MULTIPLE_SESSION_ID)
    ).toBe(false);
    // The rest are rebuilt from defaults, not kept.
    for (const id of ["single", "node", "dj"] as const) {
      const session = getPlaybackSession(id);
      expect(session?.masterVolume).toBe(1);
      expect(
        session?.channels.some((channel) => channel.id === `${id}:stale`)
      ).toBe(false);
    }
  });
});
