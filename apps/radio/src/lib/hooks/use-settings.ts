import { eq, useLiveQuery } from "@tanstack/react-db";
import { type SettingsRecord, settingsCollection } from "@/lib/collections";

const SETTINGS_ID = "app-settings";

/**
 * Get current settings.
 * NOTE: This hook uses useLiveQuery which doesn't support SSR.
 * Components using this hook must be wrapped in <ClientOnly>.
 */
export function useSettings() {
  const result = useLiveQuery((q) =>
    q
      .from({ settings: settingsCollection })
      .where(({ settings }) => eq(settings.id, SETTINGS_ID))
  );

  // Return only the properties we need to preserve TanStack DB's tracked property optimization
  return {
    data: result.data?.[0] as SettingsRecord | undefined,
    status: result.status,
  };
}

/**
 * Get player mode
 */
export function usePlayerMode() {
  const { data } = useSettings();
  return data?.player.mode ?? "multiple";
}

// Re-export mutation functions
export {
  setPlayerMode,
  setPlayerType,
  setRestoreStateOnLoad,
  setSingleModeTransitionDuration,
} from "@/lib/collections";
