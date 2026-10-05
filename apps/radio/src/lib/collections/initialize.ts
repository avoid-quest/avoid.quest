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
