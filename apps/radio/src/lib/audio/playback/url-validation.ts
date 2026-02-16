const RESERVED_STREAM_TOKENS = new Set(["left", "right", "deck-a", "deck-b"]);
const YOUTUBE_LAZY_PREFIX = "yt:";

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
    return { ok: true, normalizedUrl: `${YOUTUBE_LAZY_PREFIX}${videoId}` };
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

    return { ok: true, normalizedUrl };
  } catch {
    return { ok: false, reason: "invalid URL format" };
  }
}

export function isValidPlaybackStreamUrl(streamUrl: string): boolean {
  return validatePlaybackStreamUrl(streamUrl).ok;
}
