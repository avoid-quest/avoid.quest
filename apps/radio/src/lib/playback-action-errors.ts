import type { AudioError, AudioErrorCode, Radio } from "@/lib/audio";
import { generateErrorId } from "@/lib/audio/playback";

export type PlaybackActionMode = "single" | "node" | "dj";

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

export type PlaybackActionErrorInput = {
  mode: PlaybackActionMode;
  code?: AudioErrorCode;
  cause: unknown;
  channelId?: string;
  radio?: Radio;
  fallbackMessage?: string;
};

const DEFAULT_PLAYBACK_START_ERROR_MESSAGE =
  "Playback could not start. Check the station stream and try again.";

function getRawErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return null;
}

function messageIncludesAny(message: string, fragments: readonly string[]) {
  return fragments.some((fragment) => message.includes(fragment));
}

function hasPlaybackActionErrorShape(
  error: unknown
): error is PlaybackActionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "userMessage" in error &&
    typeof error.userMessage === "string"
  );
}

export function getFriendlyPlaybackErrorMessage(
  error: unknown,
  fallback = DEFAULT_PLAYBACK_START_ERROR_MESSAGE
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
    messageIncludesAny(rawMessage, ["notallowed", "permission", "user gesture"])
  ) {
    return "Playback needs browser audio permission before it can start.";
  }
  if (
    messageIncludesAny(rawMessage, [
      "not found",
      "cleaned up",
      "source_not_found",
    ])
  ) {
    return "Playback source is no longer available. Reload the station and try again.";
  }
  if (messageIncludesAny(rawMessage, ["network", "fetch", "stream"])) {
    return "The stream could not be reached. Check the station URL and try again.";
  }

  return fallback;
}

export function createPlaybackActionError(
  input: PlaybackActionErrorInput
): PlaybackActionError {
  return {
    cause: input.cause,
    channelId: input.channelId,
    code: input.code ?? "PLAY_ERROR",
    mode: input.mode,
    radio: input.radio,
    rawMessage: getRawErrorMessage(input.cause),
    userMessage: getFriendlyPlaybackErrorMessage(
      input.cause,
      input.fallbackMessage
    ),
  };
}

export function toRuntimeAudioError(
  error: unknown,
  code: AudioErrorCode = "PLAY_ERROR",
  radio?: Radio
): AudioError {
  const normalized = hasPlaybackActionErrorShape(error)
    ? error
    : createPlaybackActionError({
        cause: error,
        code,
        mode: "single",
        radio,
      });

  return {
    code: normalized.code,
    id: generateErrorId(),
    message: normalized.userMessage,
    radio: normalized.radio ?? radio,
    timestamp: Date.now(),
  };
}

export function reportPlaybackActionError(
  reportError: PlaybackActionErrorReporter,
  input: PlaybackActionErrorInput
): PlaybackActionError {
  const error = createPlaybackActionError(input);
  reportError(error);
  return error;
}
