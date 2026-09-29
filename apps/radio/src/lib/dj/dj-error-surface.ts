import { capturePlaybackError } from "@avoid.quest/error";
import type { Radio } from "@/lib/audio";
import { getDjRuntimeState, setDjError } from "@/lib/stores/dj-runtime-store";

export type ReportDjError = (
  message: string,
  code: string,
  error?: unknown,
  radio?: Radio | null,
  channelId?: string | null
) => void;

export function clearDjErrorSurface(channelId?: string): void {
  const current = getDjRuntimeState();
  if (channelId && current.errorChannelId !== channelId) {
    return;
  }
  setDjError(null);
}

/**
 * Record a DJ failure for diagnostics without showing it in the mixer, for
 * failures the UI already shows next to the control that caused them.
 */
export const captureDjError: ReportDjError = (message, code, error, radio) => {
  capturePlaybackError(error ?? new Error(message), {
    errorCode: code,
    errorMessage: message,
    mode: "dj",
    radioId: radio?.id,
    radioName: radio?.name,
    retryPhase: "none",
    streamUrl: radio?.streamUrl,
  });
};

export const reportDjErrorSurface: ReportDjError = (
  message,
  code,
  error,
  radio,
  channelId
) => {
  setDjError(message, channelId ?? null);
  captureDjError(message, code, error, radio, channelId);
};
