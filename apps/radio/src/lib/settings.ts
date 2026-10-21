import { getBrowserStorage } from "./browser-storage";
import {
  deletePlaybackSession,
  initializePlaybackSessions,
  initializeRadios,
  initializeSettings,
  type PlaybackSessionId,
  radiosCollection,
  settingsCollection,
} from "./collections";
import { LEGACY_MULTIPLE_SESSION_ID } from "./collections/migrations/legacy-records";

const SETTINGS_ID = "app-settings";

export const resetAllSettings = async (): Promise<void> => {
  // Clear all radios
  const radios = Array.from(radiosCollection.state.values());
  for (const radio of radios) {
    radiosCollection.delete(radio.id);
  }

  // Clear settings
  const settings = settingsCollection.state.get(SETTINGS_ID);
  if (settings) {
    settingsCollection.delete(SETTINGS_ID);
  }

  // "multiple" goes too, so a record left by the pre-Node mode cannot survive
  // a reset.
  const sessionIds: PlaybackSessionId[] = [
    "single",
    "node",
    "dj",
    LEGACY_MULTIPLE_SESSION_ID,
  ];
  for (const sessionId of sessionIds) {
    deletePlaybackSession(sessionId);
  }

  const storage = getBrowserStorage("localStorage");
  storage?.removeItem("radio-app-dj-decks");
  storage?.removeItem("radio-app-dj-mixer");
  storage?.removeItem("radio-app-single-state");

  // Reinitialize with defaults
  initializeSettings();
  await initializeRadios();
  await initializePlaybackSessions();
};
