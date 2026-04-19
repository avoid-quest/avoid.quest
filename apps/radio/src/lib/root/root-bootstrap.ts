import { QueryClient } from "@tanstack/react-query";
import {
  applySyncChanges,
  initializeCollections,
  type SyncChanges,
} from "@/lib/collections";

export function createRootQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
      },
    },
  });
}

export async function loadRootSyncChanges(
  initialize = initializeCollections
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
