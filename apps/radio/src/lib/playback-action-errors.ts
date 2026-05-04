import type { AudioError, AudioErrorCode, Radio } from "@/lib/audio";
import { generateErrorId } from "@/lib/audio/playback";

export type PlaybackActionMode = "single" | "multiple" | "dj";

export type PlaybackActionError = {
  mode: PlaybackActionMode;
  code: AudioErrorCode;
  userMessage: string;
  rawMessage: string | null;
  cause: unknown;
  channelId?: string;
  radio?: Radio;
};

export type PlaybackActionErrorReporter = (error: PlaybackActionError) => void;

function getRawErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return null;
}

export function getFriendlyPlaybackErrorMessage(
  error: unknown,
  fallback = "Playback could not start. Check the station stream and try again."
): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Playback needs browser audio permission before it can start.";
    }
    if (error.name === "NotFoundError") {
      return "The selected audio device is no longer available.";
    }
  }

  const rawMessage = getRawErrorMessage(error)?.toLowerCase() ?? "";
  if (
    rawMessage.includes("notallowed") ||
    rawMessage.includes("permission") ||
    rawMessage.includes("user gesture")
  ) {
    return "Playback needs browser audio permission before it can start.";
  }
  if (
    rawMessage.includes("not found") ||
    rawMessage.includes("cleaned up") ||
    rawMessage.includes("source_not_found")
  ) {
    return "Playback source is no longer available. Reload the station and try again.";
  }
  if (
    rawMessage.includes("network") ||
    rawMessage.includes("fetch") ||
    rawMessage.includes("stream")
  ) {
    return "The stream could not be reached. Check the station URL and try again.";
  }

  return fallback;
}

export function createPlaybackActionError(input: {
  mode: PlaybackActionMode;
  code?: AudioErrorCode;
  cause: unknown;
  channelId?: string;
  radio?: Radio;
  fallbackMessage?: string;
}): PlaybackActionError {
  return {
    mode: input.mode,
    code: input.code ?? "PLAY_ERROR",
    userMessage: getFriendlyPlaybackErrorMessage(
      input.cause,
      input.fallbackMessage
    ),
    rawMessage: getRawErrorMessage(input.cause),
    cause: input.cause,
    channelId: input.channelId,
    radio: input.radio,
  };
}

export function toRuntimeAudioError(
  error: PlaybackActionError | unknown,
  code: AudioErrorCode = "PLAY_ERROR",
  radio?: Radio
): AudioError {
  const normalized =
    typeof error === "object" &&
    error !== null &&
    "userMessage" in error &&
    typeof error.userMessage === "string"
      ? (error as PlaybackActionError)
      : createPlaybackActionError({
          mode: "single",
          code,
          cause: error,
          radio,
        });

  return {
    id: generateErrorId(),
    message: normalized.userMessage,
    code: normalized.code,
    radio: normalized.radio ?? radio,
    timestamp: Date.now(),
  };
}

export function reportPlaybackActionError(
  reportError: PlaybackActionErrorReporter,
  input: Parameters<typeof createPlaybackActionError>[0]
): PlaybackActionError {
  const error = createPlaybackActionError(input);
  reportError(error);
  return error;
}
