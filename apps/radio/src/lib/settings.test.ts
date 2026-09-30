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
afterEach(clearCollections);

describe("resetAllSettings", () => {
  test("deletes the single, node, dj and multiple sessions", async () => {
    settingsCollection.insert({
      id: "app-settings",
      player: { mode: "node", restoreStateOnLoad: true },
    });
    const sessionIds = ["single", "node", "dj", "multiple"] as const;
    for (const id of sessionIds) {
      insertStaleSession(id);
    }

    await resetAllSettings();

    // Nothing rebuilds a node session yet, so it stays gone.
    expect(getPlaybackSession("node")).toBeUndefined();
    // The rest are rebuilt from defaults, not kept.
    for (const id of ["single", "dj", "multiple"] as const) {
      const session = getPlaybackSession(id);
      expect(session?.masterVolume).toBe(1);
      expect(
        session?.channels.some((channel) => channel.id === `${id}:stale`)
      ).toBe(false);
    }
  });
});
