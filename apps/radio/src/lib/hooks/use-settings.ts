import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  type SettingsRecord,
  settingsCollection,
} from "@/lib/collections/settings";

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
    isReady: result.isReady,
  };
}

/**
 * Get player mode
 */
export function usePlayerMode() {
  const { data } = useSettings();
  return data?.player.mode ?? "single";
}

/**
 * Get audio settings reactively (output devices, CUE config, delays)
 */
export function useAudioSettings() {
  const { data } = useSettings();
  return (
    data?.audio ?? {
      mainOutputId: "default" as string,
      cueOutputId: null as string | null,
      delay: { mainDelayMs: 0, cueDelayMs: 0 },
    }
  );
}

/**
 * Get output delay settings
 */
export function useDelaySettings(): {
  mainDelayMs: number;
  cueDelayMs: number;
} {
  const { data } = useSettings();
  return data?.audio?.delay ?? { mainDelayMs: 0, cueDelayMs: 0 };
}

// Re-export mutation functions
export {
  setCueDelayMs,
  setMainDelayMs,
  setPlayerMode,
  setRestoreStateOnLoad,
  setSingleModeTransitionDuration,
} from "@/lib/collections/settings";
