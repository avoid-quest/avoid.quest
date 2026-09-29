import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Radio } from "@/lib/audio";
import { loadPlatformItem } from "@/lib/platform-item-loader";

export const platformKeys = {
  all: ["platform"] as const,
  item: (url: string) => [...platformKeys.all, "item", url] as const,
};

export type PlatformLoadCallbacks = {
  onSuccess?: (radio: Radio) => void;
  onError?: (error: string, code?: string) => void;
};

/**
 * Resolve a platform link into a Radio.
 *
 * Callbacks go with each `load` call, not the hook: TanStack Query drops them
 * once the caller unmounts or starts a newer load, so a pick the user
 * cancelled never reaches a deck.
 */
export function usePlatformLoad() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: loadPlatformItem,
    onSuccess: (result) => {
      const url = result.success ? result.radio.platformMetadata?.url : null;
      if (result.success && url) {
        queryClient.setQueryData(platformKeys.item(url), result.radio);
      }
    },
  });

  const load = (url: string, callbacks: PlatformLoadCallbacks = {}) =>
    mutation.mutate(url, {
      onError: (error) => {
        callbacks.onError?.(
          error instanceof Error
            ? error.message
            : "Failed to load platform item"
        );
      },
      onSuccess: (result) => {
        if (result.success) {
          callbacks.onSuccess?.(result.radio);
        } else {
          callbacks.onError?.(result.error, result.code);
        }
      },
    });

  return { isPending: mutation.isPending, load };
}

export function usePlatformItem(url: string | null) {
  return useQuery({
    enabled: !!url,
    gcTime: 1000 * 60 * 30,
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
    queryKey: platformKeys.item(url ?? ""),
    retry: 2,
    staleTime: 1000 * 60 * 5,
  });
}
