import { initializeDjState } from "./dj-state";
import { initializePlaybackSessions } from "./playback-sessions";
import { initializeRadios, type SyncChanges } from "./radios";
import { initializeSettings } from "./settings";
import { initializeSingleState } from "./single-state";

export {
  type DeckRecord,
  deckCollection,
  getDeckA,
  getDeckB,
  getMixer,
  initializeDjState,
  type MixerRecord,
  mixerCollection,
  resetAllDjState,
  resetDeck,
  updateDeckA,
  updateDeckB,
  updateMixer,
} from "./dj-state";
export {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
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
export {
  getSingleState,
  initializeSingleState,
  type SingleStateRecord,
  setSingleRadio,
  setSingleVolume,
  singleStateCollection,
} from "./single-state";

/**
 * Initialize all collections with default data
 * Returns sync changes if radio collection has pending updates/additions
 */
export async function initializeCollections(): Promise<SyncChanges | null> {
  const syncChanges = await initializeRadios();
  await initializeSettings();
  await initializeDjState();
  await initializeSingleState();
  await initializePlaybackSessions();

  return syncChanges;
}
