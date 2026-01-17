import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Radio } from "@/lib/audio";
import { createPlatformRadio } from "@/lib/external-url/utils";
import { loadPlatformItem as loadPlatformItemFn } from "@/utils/platform.functions";

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
 * Fetches platform item metadata using server function
 */
async function loadPlatformItem(url: string): Promise<LoadPlatformItemResult> {
  const result = await loadPlatformItemFn({ data: { url: url.trim() } });

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

/**
 * Query hook for loading platform items with caching
 *
 * Benefits:
 * - 5-minute stale time for caching
 * - Automatic retries on failure
 * - Declarative data fetching
 *
 * @example
 * const { data: radio, isLoading, error } = usePlatformItem(url);
 */
export function usePlatformItem(url: string | null) {
  return useQuery({
    queryKey: platformKeys.item(url ?? ""),
    queryFn: async () => {
      if (!url) {
        return null;
      }
      const result = await loadPlatformItem(url);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.radio;
    },
    enabled: !!url,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });
}
