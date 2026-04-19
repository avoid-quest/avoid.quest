import type { Radio } from "@/lib/audio";
import {
  clearDjErrorSurface,
  reportDjErrorSurface,
} from "@/lib/dj/dj-error-surface";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";

type UseDjTrackLoadOptions = {
  onLoad: (radio: Radio) => void;
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
      reportDjErrorSurface(message, code ?? "DJ_TRACK_RESOLUTION_FAILED");
      options.onSettled?.();
    },
  });
}
