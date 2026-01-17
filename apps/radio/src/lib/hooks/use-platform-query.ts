import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Radio } from "@/lib/audio";
import { createPlatformRadio } from "@/lib/external-url/utils";
import type { PlatformItemResponse } from "@/lib/platform-types";

/**
 * Query key factory for platform-related queries
 */
export const platformKeys = {
  all: ["platform"] as const,
  item: (url: string) => [...platformKeys.all, "item", url] as const,
};

type LoadPlatformItemResult =
  | { success: true; radio: Radio }
  | { success: false; error: string };

/**
 * Fetches platform item metadata from the API
 */
async function loadPlatformItem(url: string): Promise<LoadPlatformItemResult> {
  const response = await fetch("/api/load-platform-item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
  });

  const result = (await response.json()) as PlatformItemResponse;

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const radio = createPlatformRadio(result.streamUrl, result.metadata);
  return { success: true, radio };
}

type UsePlatformLoadOptions = {
  onSuccess?: (radio: Radio) => void;
  onError?: (error: string) => void;
};

/**
 * Mutation hook for loading platform items (SoundCloud/Bandcamp)
 *
 * Benefits over raw fetch:
 * - Automatic deduplication of concurrent requests
 * - Built-in loading/error states
 * - Cache population for future lookups
 *
 * @example
 * const { mutate: loadItem, isPending, error } = usePlatformLoad({
 *   onSuccess: (radio) => loadTrack('left', radio),
 * });
 *
 * loadItem('https://soundcloud.com/artist/track');
 */
export function usePlatformLoad(options: UsePlatformLoadOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: loadPlatformItem,
    onSuccess: (result) => {
      if (result.success) {
        // Cache the result for future lookups
        const url = result.radio.platformMetadata?.url;
        if (url) {
          queryClient.setQueryData(platformKeys.item(url), result.radio);
        }
        options.onSuccess?.(result.radio);
      } else {
        options.onError?.(result.error);
      }
    },
    onError: (error) => {
      options.onError?.(
        error instanceof Error ? error.message : "Failed to load platform item"
      );
    },
  });
}
