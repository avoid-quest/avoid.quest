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
  getSettings,
  initializeSettings,
  type SettingsRecord,
  setPlayerMode,
  setPlayerType,
  setRestoreStateOnLoad,
  setSingleModeTransitionDuration,
  settingsCollection,
  updatePlayerSettings,
} from "./settings";

/**
 * Initialize all collections with default data
 * Returns sync changes if radio collection has pending updates/additions
 */
export async function initializeCollections(): Promise<
  import("./radios").SyncChanges | null
> {
  const { initializeRadios } = await import("./radios");
  const { initializeSettings } = await import("./settings");
  const { initializeDjState } = await import("./dj-state");

  const syncChanges = await initializeRadios();
  await initializeSettings();
  await initializeDjState();

  return syncChanges;
}
