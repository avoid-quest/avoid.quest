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

export const reportDjErrorSurface: ReportDjError = (
  message,
  code,
  error,
  radio,
  channelId
) => {
  setDjError(message, channelId ?? null);
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
