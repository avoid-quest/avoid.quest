import {
  initializeRadios,
  initializeSettings,
  radiosCollection,
  settingsCollection,
} from "./collections";

const SETTINGS_ID = "app-settings";

export const resetSettings = (): void => {
  // Clear existing settings
  const settings = settingsCollection.state.get(SETTINGS_ID);
  if (settings) {
    settingsCollection.delete(SETTINGS_ID);
  }
  // Reinitialize with defaults
  initializeSettings();
};

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

  // Reinitialize with defaults
  initializeSettings();
  await initializeRadios();
};
