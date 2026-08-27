import {
  type Collection,
  type NonSingleResult,
  useLiveQuery,
} from "@tanstack/react-db";
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
  const result = useLiveQuery(
    settingsCollection as Collection<SettingsRecord, string> & NonSingleResult
  );

  return {
    data: result.data.find((settings) => settings.id === SETTINGS_ID) as
      | SettingsRecord
      | undefined,
    isReady: result.isReady,
    status: result.status,
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
      cueOutputId: null as string | null,
      delay: { cueDelayMs: 0, mainDelayMs: 0 },
      mainOutputId: "default" as string,
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
  return data?.audio?.delay ?? { cueDelayMs: 0, mainDelayMs: 0 };
}

// Re-export mutation functions
export {
  setCueDelayMs,
  setMainDelayMs,
  setPlayerMode,
  setRestoreStateOnLoad,
} from "@/lib/collections/settings";
