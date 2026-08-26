import { preloadRadioMode } from "@/components/radio/radio-mode-loader";
import { initializeCriticalCollections } from "@/lib/collections/initialize";
import { applySyncChanges, type SyncChanges } from "@/lib/collections/radios";
import { getSettings } from "@/lib/collections/settings";

export { createRootQueryClient } from "./root-query-client";

async function initializeRootCollections(): Promise<SyncChanges | null> {
  const syncChanges = await initializeCriticalCollections();
  preloadRadioMode(getSettings()?.player.mode ?? "single").catch((error) => {
    console.error("[radio] Failed to preload radio mode:", error);
  });
  return syncChanges;
}

export async function loadRootSyncChanges(
  initialize = initializeRootCollections
): Promise<SyncChanges | null> {
  return (await initialize()) ?? null;
}

export function applyRootSyncChanges(
  changes: SyncChanges,
  applyChanges = applySyncChanges
): void {
  applyChanges(changes);
}

export function reportRootBootstrapError(
  error: unknown,
  log: (message: string, error: unknown) => void = console.error
): void {
  log("[radio] Failed to initialize collections:", error);
}
