import { capturePlaybackError } from "@avoid.quest/error";
import type { Radio } from "@/lib/audio";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";

type UseDjTrackLoadOptions = {
  mode?: "dj" | "node";
  onLoad: (radio: Radio) => void;
  onError?: (message: string, code: string) => void;
  onSettled?: () => void;
};

/**
 * Resolve a search result or pasted link for a deck. Failures are only
 * recorded here; the search shows them inline, next to the pick. The options
 * in effect when `mutate` is called are the ones that run, and only while the
 * caller is still mounted.
 */
export function useDjTrackLoad(options: UseDjTrackLoadOptions) {
  const { isPending, load } = usePlatformLoad();
  const mutate = (url: string) =>
    load(url, {
      onError: (message, code, cause) => {
        const errorCode = code ?? "DJ_TRACK_RESOLUTION_FAILED";
        capturePlaybackError(cause ?? new Error(message), {
          errorCode,
          errorMessage: message,
          mode: options.mode ?? "dj",
          streamUrl: url,
        });
        options.onError?.(message, errorCode);
        options.onSettled?.();
      },
      onSuccess: (radio) => {
        options.onLoad(radio);
        options.onSettled?.();
      },
    });
  return { isPending, mutate };
}
