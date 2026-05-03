import type { Radio } from "@/lib/audio";
import {
  clearDjErrorSurface,
  reportDjErrorSurface,
} from "@/lib/dj/dj-error-surface";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";

type UseDjTrackLoadOptions = {
  onLoad: (radio: Radio) => void;
  onError?: (message: string, code: string) => void;
  onSettled?: () => void;
};

export function useDjTrackLoad(options: UseDjTrackLoadOptions) {
  return usePlatformLoad({
    onSuccess: (radio) => {
      clearDjErrorSurface();
      options.onLoad(radio);
      options.onSettled?.();
    },
    onError: (message, code) => {
      const errorCode = code ?? "DJ_TRACK_RESOLUTION_FAILED";
      reportDjErrorSurface(message, errorCode);
      options.onError?.(message, errorCode);
      options.onSettled?.();
    },
  });
}
