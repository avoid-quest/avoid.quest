import { initializeCriticalCollections } from "./initialize";
import type { SyncChanges } from "./radios";

export { initializeCriticalCollections } from "./initialize";
export {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  deletePlaybackSession,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  initializePlaybackSessions,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  type PlaybackSessionRecord,
  playbackSessionsCollection,
  removePlaybackChannel,
  replacePlaybackChannels,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  setPlaybackSessionTempo,
  updatePlaybackChannel,
  updatePlaybackSession,
  upsertPlaybackChannel,
} from "./playback-sessions";
export {
  addDismissedRadio,
  addDismissedRadios,
  applySyncChanges,
  clearDismissedRadios,
  getAllRadios,
  getDismissedRadios,
  getEnabledRadios,
  getSyncChanges,
  hasSyncChanges,
  initializeRadios,
  type RadioRecord,
  radiosCollection,
  removeDismissedRadio,
  type SyncChanges,
  syncRadios,
} from "./radios";
export {
  addSessionRadio,
  getSessionRadios,
  isSessionRadio,
  removeSessionRadio,
  type SessionRadioRecord,
  sessionRadiosCollection,
} from "./session-radios";
export {
  getAudioSettings,
  getDelaySettings,
  getInputDeckSettings,
  getSettings,
  type InputDeckSettings,
  initializeSettings,
  type SettingsRecord,
  setCueDelayMs,
  setCueOutputDevice,
  setInputDeckChannelFilter,
  setInputDeckCollapsed,
  setInputDeckDeviceId,
  setInputDeckEffectsDryWet,
  setInputDeckGoLiveOnStart,
  setInputDeckPan,
  setInputDeckVolume,
  setMainDelayMs,
  setMainOutputDevice,
  setPlayerMode,
  setRestoreStateOnLoad,
  setSingleModeTransitionDuration,
  settingsCollection,
  updateInputDeckSettings,
  updatePlayerSettings,
} from "./settings";

/**
 * Initialize all collections with default data
 * Returns sync changes if radio collection has pending updates/additions
 */
export async function initializeCollections(): Promise<SyncChanges | null> {
  const syncChanges = await initializeCriticalCollections();
  const { initializePlaybackSessions } = await import("./playback-sessions");
  await initializePlaybackSessions();

  return syncChanges;
}
