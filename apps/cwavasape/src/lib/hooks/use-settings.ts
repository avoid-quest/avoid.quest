import { eq, useLiveQuery } from "@tanstack/react-db";
import { type Settings, settingsCollection } from "@/lib/collections";
import { DEFAULT_IMAGE_SIZE, DEFAULT_USERNAME } from "@/lib/const";

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

  return {
    data: result.data?.[0] as Settings | undefined,
    status: result.status,
    isReady: result.isReady,
  };
}

export function useUsername() {
  const { data } = useSettings();
  return data?.username ?? DEFAULT_USERNAME;
}

export function useImageSize() {
  const { data } = useSettings();
  return data?.imageSize ?? DEFAULT_IMAGE_SIZE;
}

// Re-export mutations
export { setImageSize, setUsername } from "@/lib/collections";
