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
  getAllRadios,
  getEnabledRadios,
  initializeRadios,
  type RadioRecord,
  radiosCollection,
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
 */
export async function initializeCollections(): Promise<void> {
  const { initializeRadios } = await import("./radios");
  const { initializeSettings } = await import("./settings");
  const { initializeDjState } = await import("./dj-state");

  await initializeRadios();
  await initializeSettings();
  await initializeDjState();
}
