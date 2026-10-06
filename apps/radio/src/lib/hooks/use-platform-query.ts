import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Radio } from "@/lib/audio";
import { loadPlatformItem } from "@/lib/platform-item-loader";

export const platformKeys = {
  all: ["platform"] as const,
  item: (url: string) => [...platformKeys.all, "item", url] as const,
};

export type PlatformLoadCallbacks = {
  onSuccess?: (radio: Radio) => void;
  onError?: (error: string, code?: string, cause?: unknown) => void;
};

/**
 * Resolve a platform link into a Radio.
 *
 * Callbacks go with each `load` call, not the hook: TanStack Query drops them
 * once the caller unmounts or starts a newer load, so a pick the user
 * cancelled never reaches a deck. That load is aborted too, so a Spotify
 * match stops searching YouTube for nobody.
 */
export function usePlatformLoad() {
  const queryClient = useQueryClient();
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const mutation = useMutation({
    mutationFn: ({ signal, url }: { signal: AbortSignal; url: string }) =>
      loadPlatformItem(url, { signal }),
    onSuccess: (result) => {
      const url = result.success ? result.radio.platformMetadata?.url : null;
      if (result.success && url) {
        queryClient.setQueryData(platformKeys.item(url), result.radio);
      }
    },
  });

  const load = (url: string, callbacks: PlatformLoadCallbacks = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    mutation.mutate(
      { signal: controller.signal, url },
      {
        onError: (error) => {
          if (controller.signal.aborted) {
            return;
          }
          callbacks.onError?.(
            error instanceof Error
              ? error.message
              : "Failed to load platform item",
            undefined,
            error
          );
        },
        onSuccess: (result) => {
          if (controller.signal.aborted) {
            return;
          }
          if (result.success) {
            callbacks.onSuccess?.(result.radio);
          } else {
            callbacks.onError?.(result.error, result.code, result.cause);
          }
        },
      }
    );
  };

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
        throw result.cause ?? new Error(result.error);
      }
      return result.radio;
    },
    queryKey: platformKeys.item(url ?? ""),
    retry: 2,
    staleTime: 1000 * 60 * 5,
  });
}
