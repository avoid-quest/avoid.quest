// biome-ignore lint/performance/noNamespaceImport: namespace import required by Sentry SDK
import * as Sentry from "@sentry/tanstackstart-react";

type PlaybackMode = "single" | "multiple" | "dj";
type RetryPhase = "initial" | "fallback-no-cors" | "none";

export type PlaybackTelemetryPayload = {
  mode: PlaybackMode;
  radioName?: string;
  radioId?: string | number;
  streamUrl?: string;
  errorCode: string;
  errorMessage: string;
  retryPhase?: RetryPhase;
};

const ACTIONABLE_PREFIXES = [
  "MEDIA_ERROR_",
  "PLAYBACK_",
  "STREAM_",
  "DJ_",
  "SINGLE_",
  "MULTIPLE_",
];

const DEFAULT_DEDUPE_TTL_MS = 30_000;

export type DedupeStore = {
  hasSeen: (key: string) => boolean;
};

function isActionableCode(errorCode: string): boolean {
  return ACTIONABLE_PREFIXES.some((prefix) => errorCode.startsWith(prefix));
}

function normalizeMessage(message: string): string {
  return message.trim().toLowerCase();
}

export function shouldCapturePlaybackError(errorCode: string): boolean {
  return isActionableCode(errorCode);
}

export function buildPlaybackEventKey(
  payload: PlaybackTelemetryPayload
): string {
  return [
    payload.mode,
    payload.errorCode,
    payload.streamUrl ?? "no-url",
    normalizeMessage(payload.errorMessage),
  ].join("|");
}

export function createDedupeStore(
  ttlMs = DEFAULT_DEDUPE_TTL_MS,
  now = () => Date.now()
): DedupeStore {
  const seen = new Map<string, number>();

  return {
    hasSeen(key) {
      const nowTs = now();

      // periodic cleanup for stale entries
      for (const [entryKey, expiresAt] of seen) {
        if (expiresAt <= nowTs) {
          seen.delete(entryKey);
        }
      }

      const expiresAt = seen.get(key);
      if (expiresAt && expiresAt > nowTs) {
        return true;
      }

      seen.set(key, nowTs + ttlMs);
      return false;
    },
  };
}

const dedupeStore = createDedupeStore();

function tryGetHost(streamUrl?: string): string {
  if (!streamUrl) {
    return "unknown";
  }
  try {
    return new URL(streamUrl).host;
  } catch {
    return "invalid-url";
  }
}

export function capturePlaybackError(
  error: unknown,
  payload: PlaybackTelemetryPayload
): void {
  if (!shouldCapturePlaybackError(payload.errorCode)) {
    return;
  }

  const dedupeKey = buildPlaybackEventKey(payload);
  if (dedupeStore.hasSeen(dedupeKey)) {
    return;
  }

  const capturedError =
    error instanceof Error ? error : new Error(payload.errorMessage);

  Sentry.withScope((scope) => {
    scope.setTag("feature", "radio-playback");
    scope.setTag("mode", payload.mode);
    scope.setTag("error_code", payload.errorCode);
    scope.setTag("stream_host", tryGetHost(payload.streamUrl));
    scope.setTag("retry_phase", payload.retryPhase ?? "none");
    scope.setContext("playback", {
      radioName: payload.radioName,
      radioId: payload.radioId ? String(payload.radioId) : undefined,
      streamUrl: payload.streamUrl,
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
      retryPhase: payload.retryPhase ?? "none",
    });
    Sentry.captureException(capturedError);
  });
}
