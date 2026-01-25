import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Settings,
  settingsCollection,
  setUsername,
} from "@/lib/collections";

const SETTINGS_ID = "app-settings";

/**
 * Get current settings reactively via TanStack DB.
 * NOTE: Uses useLiveQuery which doesn't support SSR.
 * Components using this hook must be wrapped in <ClientOnly>.
 */
export function useSettings() {
  const result = useLiveQuery((q) =>
    q
      .from({ settings: settingsCollection })
      .where(({ settings }) => eq(settings.id, SETTINGS_ID))
  );

  return {
    data: result.data?.[0] as Settings | undefined,
    status: result.status,
    isReady: result.isReady,
  };
}

/**
 * Returns a function to set username and invalidate pins query.
 */
export function useSetUsername() {
  const queryClient = useQueryClient();
  return (username: string) => {
    setUsername(username);
    queryClient.invalidateQueries({ queryKey: ["pins"] });
  };
}

// Re-export mutations for direct use
export {
  setImageSize,
  setScrollSensitivity,
  setUsername,
} from "@/lib/collections";
