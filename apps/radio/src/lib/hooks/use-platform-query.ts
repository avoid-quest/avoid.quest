import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Radio } from "@/lib/audio";
import { loadPlatformItem } from "@/lib/platform-item-loader";

export const platformKeys = {
  all: ["platform"] as const,
  item: (url: string) => [...platformKeys.all, "item", url] as const,
};

type UsePlatformLoadOptions = {
  onSuccess?: (radio: Radio) => void;
  onError?: (error: string, code?: string) => void;
};

export function usePlatformLoad(options: UsePlatformLoadOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: loadPlatformItem,
    onError: (error) => {
      options.onError?.(
        error instanceof Error ? error.message : "Failed to load platform item"
      );
    },
    onSuccess: (result) => {
      if (result.success) {
        const url = result.radio.platformMetadata?.url;
        if (url) {
          queryClient.setQueryData(platformKeys.item(url), result.radio);
        }
        options.onSuccess?.(result.radio);
      } else {
        options.onError?.(result.error, result.code);
      }
    },
  });
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
