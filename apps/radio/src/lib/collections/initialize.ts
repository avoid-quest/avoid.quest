import { initializeRadios, radiosCollection } from "./radios";
import { initializeSettings, settingsCollection } from "./settings";

/** Hydrates only the collections required to choose and render the radio mode. */
export async function initializeCriticalCollections(
  onSettingsReady?: () => void
) {
  const radios = radiosCollection.preload().then(() => initializeRadios());
  radiosInitialization = radios;
  const [syncChanges] = await Promise.all([
    radios,
    settingsCollection.preload().then(async () => {
      await initializeSettings();
      // Mode discovery need not wait for station defaults/migrations. Mounting
      // still waits for this function and the mode's session preparation.
      onSettingsReady?.();
    }),
  ]);
  return syncChanges;
}

/**
 * The latest radio init. Playback preparation waits for it: migrating a
 * Multiple session keeps only stations the library holds, and stations
 * recovered from damaged storage arrive only once init inserts them.
 */
let radiosInitialization: Promise<unknown> | undefined;
let playbackPreparation: Promise<void> | undefined;

/** Apply page-load restoration once, shared by independently loaded views. */
export function preparePlaybackSessions(): Promise<void> {
  playbackPreparation ??= Promise.all([
    import("./playback-sessions"),
    radiosInitialization,
  ])
    .then(([{ initializePlaybackSessions }]) => initializePlaybackSessions())
    .catch((error: unknown) => {
      playbackPreparation = undefined;
      throw error;
    });
  return playbackPreparation;
}
