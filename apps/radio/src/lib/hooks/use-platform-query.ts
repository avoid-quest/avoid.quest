import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Radio } from "@/lib/audio";
import { createPlatformRadio } from "@/lib/external-url/utils";
import { loadPlatformItem as loadPlatformItemFn } from "@/utils/platform.functions";

export const platformKeys = {
  all: ["platform"] as const,
  item: (url: string) => [...platformKeys.all, "item", url] as const,
};

type LoadPlatformItemResult =
  | { success: true; radio: Radio }
  | { success: false; error: string };

async function loadPlatformItem(url: string): Promise<LoadPlatformItemResult> {
  const result = await loadPlatformItemFn({ data: { url: url.trim() } });

  if (!result.ok) {
    return { success: false, error: result.error.message };
  }

  const radio = createPlatformRadio(
    result.data.streamUrl,
    result.data.metadata
  );
  return { success: true, radio };
}

type UsePlatformLoadOptions = {
  onSuccess?: (radio: Radio) => void;
  onError?: (error: string) => void;
};

export function usePlatformLoad(options: UsePlatformLoadOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: loadPlatformItem,
    onSuccess: (result) => {
      if (result.success) {
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 2,
  });
}
