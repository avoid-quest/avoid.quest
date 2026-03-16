import { initializeDjState } from "./dj-state";
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
  setPlayerType,
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

  return syncChanges;
}
