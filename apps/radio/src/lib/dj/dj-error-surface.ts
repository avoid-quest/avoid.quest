import { capturePlaybackError } from "@avoid.quest/error";
import type { Radio } from "@/lib/audio";
import { setDjError } from "@/lib/stores/dj-runtime-store";

export type ReportDjError = (
  message: string,
  code: string,
  error?: unknown,
  radio?: Radio | null
) => void;

export function clearDjErrorSurface(): void {
  setDjError(null);
}

export const reportDjErrorSurface: ReportDjError = (
  message,
  code,
  error,
  radio
) => {
  setDjError(message);
  capturePlaybackError(error ?? new Error(message), {
    mode: "dj",
    radioId: radio?.id,
    radioName: radio?.name,
    streamUrl: radio?.streamUrl,
    errorCode: code,
    errorMessage: message,
    retryPhase: "none",
  });
};
