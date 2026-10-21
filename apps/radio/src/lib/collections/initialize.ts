import { initializeRadios, radiosCollection } from "./radios";
import { initializeSettings, settingsCollection } from "./settings";

/** Hydrates only the collections required to choose and render the radio mode. */
export async function initializeCriticalCollections(
  onSettingsReady?: () => void
) {
  const [syncChanges] = await Promise.all([
    radiosCollection.preload().then(() => initializeRadios()),
    settingsCollection.preload().then(async () => {
      await initializeSettings();
      // Mode discovery need not wait for station defaults/migrations. Mounting
      // still waits for this function and the mode's session preparation.
      onSettingsReady?.();
    }),
  ]);
  return syncChanges;
}

let playbackPreparation: Promise<void> | undefined;

/** Apply page-load restoration once, shared by independently loaded views. */
export function preparePlaybackSessions(): Promise<void> {
  playbackPreparation ??= import("./playback-sessions")
    .then(({ initializePlaybackSessions }) => initializePlaybackSessions())
    .catch((error: unknown) => {
      playbackPreparation = undefined;
      throw error;
    });
  return playbackPreparation;
}
