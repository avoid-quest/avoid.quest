import {
  type Collection,
  type NonSingleResult,
  useLiveQuery,
} from "@tanstack/react-db";
import { useRef, useSyncExternalStore } from "react";
import {
  type SettingsRecord,
  settingsCollection,
} from "@/lib/collections/settings";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";

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

function subscribeSettings(onChange: () => void) {
  const subscription = settingsCollection.subscribeChanges(onChange);
  const unsubscribeStatus = settingsCollection.on("status:change", onChange);
  return () => {
    subscription.unsubscribe();
    unsubscribeStatus();
  };
}

/** Cache the selected value, including nested fields recreated by storage sync. */
function useSettingsProjection<T>(
  select: (record: SettingsRecord | undefined) => T
): T {
  const cached = useRef<{ signature: string | undefined; value: T } | null>(
    null
  );
  const getSnapshot = () => {
    const value = select(settingsCollection.state.get(SETTINGS_ID));
    const signature = JSON.stringify(value);
    if (!cached.current || cached.current.signature !== signature) {
      cached.current = { signature, value };
    }
    return cached.current.value;
  };
  return useSyncExternalStore(subscribeSettings, getSnapshot, getSnapshot);
}

export function usePlayerModeState() {
  return useSettingsProjection((record) => ({
    hasSettings: Boolean(record),
    isReady: settingsCollection.status === "ready",
    mode: normalizePlayerMode(record?.player.mode),
  }));
}

export function usePlayerMode() {
  return useSettingsProjection((record) =>
    normalizePlayerMode(record?.player.mode)
  );
}

const DEFAULT_DELAY = { cueDelayMs: 0, mainDelayMs: 0 };
const DEFAULT_AUDIO = {
  cueOutputId: null as string | null,
  delay: DEFAULT_DELAY,
  mainOutputId: "default",
};

export function useAudioSettings() {
  return useSettingsProjection((record) => record?.audio ?? DEFAULT_AUDIO);
}

export function useDelaySettings(): {
  mainDelayMs: number;
  cueDelayMs: number;
} {
  return useSettingsProjection(
    (record) => record?.audio?.delay ?? DEFAULT_DELAY
  );
}

// Re-export mutation functions
export {
  setCueDelayMs,
  setMainDelayMs,
  setPlayerMode,
  setRestoreStateOnLoad,
} from "@/lib/collections/settings";
