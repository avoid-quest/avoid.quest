import {
  initializeCriticalCollections,
  preparePlaybackSessions,
} from "./initialize";
import type { SyncChanges } from "./radios";

export {
  createDefaultChannel,
  deletePlaybackSession,
  getPlaybackSession,
  initializePlaybackSessions,
  type PlaybackSessionId,
  playbackSessionsCollection,
  updatePlaybackChannel,
  updatePlaybackSession,
} from "./playback-sessions";
export {
  initializeRadios,
  type RadioRecord,
  radiosCollection,
  type SyncChanges,
} from "./radios";
export {
  addSessionRadio,
  sessionRadiosCollection,
} from "./session-radios";
export {
  getAudioSettings,
  getDelaySettings,
  getSettings,
  initializeSettings,
  type SettingsRecord,
  setRestoreStateOnLoad,
  settingsCollection,
  updatePlayerSettings,
} from "./settings";

/**
 * Initialize all collections with default data
 * Returns sync changes if radio collection has pending updates/additions
 */
export async function initializeCollections(): Promise<SyncChanges | null> {
  const syncChanges = await initializeCriticalCollections();
  await preparePlaybackSessions();

  return syncChanges;
}
