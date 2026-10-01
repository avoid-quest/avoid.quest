import { parseSpotifyTrackPlaceholder } from "@avoid.quest/platforms/spotify/detect";

const RESERVED_STREAM_TOKENS = new Set(["left", "right", "deck-a", "deck-b"]);
const YOUTUBE_LAZY_PREFIX = "yt:";
const SAME_ORIGIN_PATH_BASE = "https://same-origin.invalid";

export function isSameOriginPlaybackPath(value: string): boolean {
  if (!value.startsWith("/")) {
    return false;
  }
  try {
    return (
      new URL(value, SAME_ORIGIN_PATH_BASE).origin === SAME_ORIGIN_PATH_BASE
    );
  } catch {
    return false;
  }
}

export type PlaybackStreamUrlValidation =
  | { ok: true; normalizedUrl: string }
  | { ok: false; reason: string };

export function validatePlaybackStreamUrl(
  streamUrl: string
): PlaybackStreamUrlValidation {
  const normalizedUrl = streamUrl.trim();
  if (!normalizedUrl) {
    return { ok: false, reason: "missing stream URL" };
  }

  if (RESERVED_STREAM_TOKENS.has(normalizedUrl.toLowerCase())) {
    return { ok: false, reason: "reserved token cannot be used as stream URL" };
  }

  if (normalizedUrl.startsWith(YOUTUBE_LAZY_PREFIX)) {
    const videoId = normalizedUrl.slice(YOUTUBE_LAZY_PREFIX.length).trim();
    if (!videoId) {
      return { ok: false, reason: "missing YouTube video ID" };
    }
    return { normalizedUrl: `${YOUTUBE_LAZY_PREFIX}${videoId}`, ok: true };
  }

  // An album or playlist track matched to YouTube only when it plays.
  if (parseSpotifyTrackPlaceholder(normalizedUrl)) {
    return { normalizedUrl, ok: true };
  }

  // Relative paths support same-origin audio assets.
  if (normalizedUrl.startsWith("/")) {
    if (!isSameOriginPlaybackPath(normalizedUrl)) {
      return { ok: false, reason: "scheme-relative URL is not allowed" };
    }
    return { normalizedUrl, ok: true };
  }

  try {
    const parsed = new URL(normalizedUrl);
    const isSupportedProtocol =
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "blob:";
    if (!isSupportedProtocol) {
      return {
        ok: false,
        reason: `unsupported protocol: ${parsed.protocol}`,
      };
    }

    return { normalizedUrl, ok: true };
  } catch {
    return { ok: false, reason: "invalid URL format" };
  }
}

export function isValidPlaybackStreamUrl(streamUrl: string): boolean {
  return validatePlaybackStreamUrl(streamUrl).ok;
}
