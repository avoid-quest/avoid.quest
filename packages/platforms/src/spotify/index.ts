/**
 * Spotify
 *
 * Spotify's own audio is DRM-protected, so a Spotify link plays as a mirror:
 * metadata comes from Spotify's public embed page (no account or API key),
 * and the audio from the YouTube upload that best matches it. See RESEARCH.md.
 */

import {
  needsSpotifyResolution,
  parseSpotifyRef,
  SPOTIFY_UNSUPPORTED_LINK_MESSAGE,
} from "./detect.js";
import { parseSpotifyEmbedPage, SPOTIFY_EMBED_BASE_URL } from "./metadata.js";
import {
  resolveSpotifyItemStream,
  type SpotifyItemStreamOptions,
} from "./mirror.js";
import {
  resolveSpotifyShortLink,
  SpotifyUnsupportedLinkError,
} from "./short-link.js";
import type {
  SpotifyItemError,
  SpotifyItemResponse,
  SpotifyMetadataResponse,
} from "./types.js";

export type { SpotifyRef } from "./detect.js";
export {
  detectSpotifyItemType,
  getSpotifyTrackPlaceholder,
  getSpotifyUri,
  getSpotifyUrl,
  isSpotifyUrl,
  needsSpotifyResolution,
  normalizeSpotifyUrl,
  parseSpotifyRef,
  parseSpotifyTrackPlaceholder,
  SPOTIFY_UNSUPPORTED_LINK_MESSAGE,
} from "./detect.js";
export type { SpotifyCandidateScore } from "./match.js";
export {
  buildSpotifyYouTubeQuery,
  cleanSpotifyTitle,
  rankYouTubeCandidates,
  SPOTIFY_MATCH_MIN_SCORE,
  scoreYouTubeCandidate,
  selectYouTubeMatch,
} from "./match.js";
export {
  parseSpotifyEmbedPage,
  SPOTIFY_EMBED_BASE_URL,
} from "./metadata.js";
export type {
  SpotifyItemStreamOptions,
  SpotifyTrackStreamOptions,
} from "./mirror.js";
export {
  resolveSpotifyItemStream,
  resolveSpotifyTrackStream,
  SPOTIFY_NO_MATCH_ERROR,
  toSpotifyMatchTrack,
  withSpotifyTrackStream,
} from "./mirror.js";
export type { SpotifyShortLinkOptions } from "./short-link.js";
export {
  findSpotifyLinkInPage,
  resolveSpotifyShortLink,
  SpotifyUnsupportedLinkError,
} from "./short-link.js";
export type {
  SpotifyItemError,
  SpotifyItemResponse,
  SpotifyItemResult,
  SpotifyItemType,
  SpotifyMatchTrack,
  SpotifyMetadata,
  SpotifyMetadataResponse,
  SpotifyTrackInfo,
  SpotifyTrackStreamResponse,
  SpotifyYouTubeCandidate,
  SpotifyYouTubeMatch,
  SpotifyYouTubeSource,
} from "./types.js";
export {
  isSpotifyHostname,
  isSpotifyPageHostname,
  isSpotifyShortLinkHostname,
} from "./url-policy.js";

const LOOKUP_TIMEOUT_MS = 10_000;

export type SpotifyMetadataOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type SpotifyItemOptions = SpotifyMetadataOptions &
  SpotifyItemStreamOptions;

function createErrorResponse(message: string): SpotifyItemError {
  return { error: message, success: false };
}

function unsupportedLinkResponse(): SpotifyItemError {
  return {
    error: SPOTIFY_UNSUPPORTED_LINK_MESSAGE,
    success: false,
    unsupported: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Unknown error occurred";
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchSpotifyPage(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html", "accept-language": "en" },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Spotify returned HTTP ${response.status}`);
  }
  return await response.text();
}

/**
 * Resolves a Spotify track, album or playlist link (web URL, `spotify:` URI
 * or `spotify.link` share link) to metadata, without matching any audio.
 * Run it server-side: Spotify's pages send no CORS headers.
 *
 * Album and playlist tracks carry `spotify:track:<id>` placeholder stream
 * URLs. Playlists list at most their first 100 tracks.
 */
export async function getSpotifyMetadata(
  url: string,
  { fetchImpl = fetch, signal }: SpotifyMetadataOptions = {}
): Promise<SpotifyMetadataResponse> {
  try {
    const requestSignal = withTimeout(signal);
    const link = needsSpotifyResolution(url)
      ? await resolveSpotifyShortLink(url, {
          fetchImpl,
          signal: requestSignal,
        })
      : url;
    const ref = parseSpotifyRef(link);
    if (!ref) {
      return unsupportedLinkResponse();
    }

    const embedHtml = await fetchSpotifyPage(
      `${SPOTIFY_EMBED_BASE_URL}/${ref.type}/${ref.id}`,
      fetchImpl,
      requestSignal
    );
    return parseSpotifyEmbedPage(ref, embedHtml);
  } catch (error) {
    if (error instanceof SpotifyUnsupportedLinkError) {
      return unsupportedLinkResponse();
    }
    return createErrorResponse(
      `Failed to get Spotify item: ${errorMessage(error)}`
    );
  }
}

/**
 * Resolves a Spotify link to Spotify metadata and a playable stream URL from
 * the matching YouTube upload: `getSpotifyMetadata`, then
 * `resolveSpotifyItemStream`. A track link is matched; an album or playlist
 * matches only its first playable track and keeps `spotify:track:<id>`
 * placeholders for the rest.
 */
export async function getSpotifyItem(
  url: string,
  options: SpotifyItemOptions
): Promise<SpotifyItemResponse> {
  const resolved = await getSpotifyMetadata(url, options);
  if (!resolved.success) {
    return resolved;
  }
  return await resolveSpotifyItemStream(resolved.metadata, options);
}
