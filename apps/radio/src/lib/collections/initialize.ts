import { initializeRadios, radiosCollection } from "./radios";
import { initializeSettings, settingsCollection } from "./settings";

/** Hydrates only the collections required to choose and render the radio mode. */
export async function initializeCriticalCollections() {
  await Promise.all([radiosCollection.preload(), settingsCollection.preload()]);
  const [syncChanges] = await Promise.all([
    initializeRadios(),
    initializeSettings(),
  ]);
  return syncChanges;
}
