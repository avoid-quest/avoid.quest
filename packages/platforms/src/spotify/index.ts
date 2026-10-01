/**
 * Spotify
 *
 * Spotify's own audio is DRM-protected, so a Spotify link plays as a mirror:
 * metadata comes from Spotify's public embed page (no account or API key),
 * and the audio from the YouTube upload that best matches it. See RESEARCH.md.
 */

import { needsSpotifyResolution, parseSpotifyRef } from "./detect.js";
import { buildSpotifyYouTubeQuery, rankYouTubeCandidates } from "./match.js";
import { parseSpotifyEmbedPage, SPOTIFY_EMBED_BASE_URL } from "./metadata.js";
import { resolveSpotifyShortLink } from "./short-link.js";
import type {
  SpotifyItemError,
  SpotifyItemResponse,
  SpotifyMatchTrack,
  SpotifyMetadata,
  SpotifyMetadataResponse,
  SpotifyTrackInfo,
  SpotifyTrackStreamResponse,
  SpotifyYouTubeCandidate,
  SpotifyYouTubeMatch,
  SpotifyYouTubeSource,
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
export type { SpotifyShortLinkOptions } from "./short-link.js";
export {
  findSpotifyLinkInPage,
  resolveSpotifyShortLink,
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
/** Matched streams tried before giving up on a track. */
const MAX_STREAM_ATTEMPTS = 2;
/** Collection tracks tried, in order, for the stream that plays first. */
const DEFAULT_FIRST_TRACK_ATTEMPTS = 3;
const ARTIST_CREDIT_SEPARATOR = ", ";

export const SPOTIFY_NO_MATCH_ERROR =
  "No YouTube upload is close enough to this Spotify track";

export type SpotifyMetadataOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type SpotifyTrackStreamOptions = {
  youtube: SpotifyYouTubeSource;
  signal?: AbortSignal;
};

export type SpotifyItemOptions = SpotifyMetadataOptions & {
  youtube: SpotifyYouTubeSource;
  /**
   * How many album or playlist tracks to try, in order, for the one stream
   * matched up front. Default 3. The rest stay unmatched until played.
   */
  firstTrackAttempts?: number;
};

function createErrorResponse(message: string): SpotifyItemError {
  return { error: message, success: false };
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
      return createErrorResponse(
        "Unsupported Spotify URL: only track, album and playlist links can be played"
      );
    }

    const embedHtml = await fetchSpotifyPage(
      `${SPOTIFY_EMBED_BASE_URL}/${ref.type}/${ref.id}`,
      fetchImpl,
      requestSignal
    );
    return parseSpotifyEmbedPage(ref, embedHtml);
  } catch (error) {
    return createErrorResponse(
      `Failed to get Spotify item: ${errorMessage(error)}`
    );
  }
}

/** What matching needs from a Spotify track or track-link metadata. */
export function toSpotifyMatchTrack(
  track: SpotifyTrackInfo | SpotifyMetadata
): SpotifyMatchTrack {
  const artists =
    "artists" in track && track.artists?.length
      ? track.artists
      : (track.artist
          ?.split(ARTIST_CREDIT_SEPARATOR)
          .map((artist) => artist.trim())
          .filter(Boolean) ?? []);
  return { artists, duration: track.duration, name: track.name ?? "" };
}

async function searchCandidates(
  youtube: SpotifyYouTubeSource,
  query: string,
  filter: "songs" | "videos",
  signal: AbortSignal | undefined
): Promise<readonly SpotifyYouTubeCandidate[]> {
  try {
    return await youtube.search(query, filter, signal);
  } catch (error) {
    throw new Error(`YouTube search failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

type StreamAttempt =
  | { success: true; streamUrl: string; match: SpotifyYouTubeMatch }
  | { success: false; error?: unknown };

async function streamFirstPlayable(
  youtube: SpotifyYouTubeSource,
  matches: readonly SpotifyYouTubeMatch[],
  tried: Set<string>,
  signal: AbortSignal | undefined
): Promise<StreamAttempt> {
  let lastError: unknown;
  const untried = matches.filter((match) => !tried.has(match.videoId));
  for (const match of untried.slice(0, MAX_STREAM_ATTEMPTS)) {
    tried.add(match.videoId);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: the runner-up is only tried when the best match fails
      const streamUrl = await youtube.resolveStream(match.videoId, signal);
      return { match, streamUrl, success: true };
    } catch (error) {
      lastError = error;
      if (signal?.aborted) {
        break;
      }
    }
  }
  return { error: lastError, success: false };
}

/**
 * Finds the YouTube upload that matches a Spotify track and resolves its
 * stream URL. Tries YouTube Music songs first; when none is close enough or
 * none will stream, searches videos too. Up to two matches are tried per
 * search before giving up.
 * Runs wherever `youtube` runs, so in the browser with a browser client.
 */
export async function resolveSpotifyTrackStream(
  track: SpotifyMatchTrack,
  { signal, youtube }: SpotifyTrackStreamOptions
): Promise<SpotifyTrackStreamResponse> {
  if (!(track.name.trim() && track.artists.length > 0)) {
    return createErrorResponse("Spotify track has no title or artist to match");
  }
  const query = buildSpotifyYouTubeQuery(track);
  const tried = new Set<string>();
  let matched = false;
  let streamError: unknown;

  try {
    const songs = await searchCandidates(youtube, query, "songs", signal);
    const songMatches = rankYouTubeCandidates(track, songs);
    matched = songMatches.length > 0;
    const fromSongs = await streamFirstPlayable(
      youtube,
      songMatches,
      tried,
      signal
    );
    if (fromSongs.success) {
      return fromSongs;
    }
    streamError = fromSongs.error;
    signal?.throwIfAborted();

    const videos = await searchCandidates(youtube, query, "videos", signal);
    const videoMatches = rankYouTubeCandidates(track, videos);
    matched ||= videoMatches.length > 0;
    const fromVideos = await streamFirstPlayable(
      youtube,
      videoMatches,
      tried,
      signal
    );
    if (fromVideos.success) {
      return fromVideos;
    }
    streamError = fromVideos.error ?? streamError;
  } catch (error) {
    return createErrorResponse(errorMessage(error));
  }

  return createErrorResponse(
    matched
      ? `Matched YouTube video could not be streamed: ${errorMessage(streamError)}`
      : SPOTIFY_NO_MATCH_ERROR
  );
}

/** A copy of `track` that plays the matched stream. */
export function withSpotifyTrackStream(
  track: SpotifyTrackInfo,
  stream: Extract<SpotifyTrackStreamResponse, { success: true }>
): SpotifyTrackInfo {
  return {
    ...track,
    streamUrl: stream.streamUrl,
    youtubeMatch: stream.match,
    youtubeVideoId: stream.match.videoId,
  };
}

async function matchFirstCollectionTrack(
  metadata: SpotifyMetadata,
  options: SpotifyItemOptions
): Promise<SpotifyItemResponse> {
  const tracks = metadata.tracks ?? [];
  const attempts = Math.max(
    1,
    options.firstTrackAttempts ?? DEFAULT_FIRST_TRACK_ATTEMPTS
  );
  let firstError: string | undefined;
  for (const [index, track] of tracks.slice(0, attempts).entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: later tracks are only matched when earlier ones fail
    const stream = await resolveSpotifyTrackStream(toSpotifyMatchTrack(track), {
      signal: options.signal,
      youtube: options.youtube,
    });
    if (stream.success) {
      const matchedTracks = [...tracks];
      matchedTracks[index] = withSpotifyTrackStream(track, stream);
      return {
        metadata: {
          ...metadata,
          streamUrl: stream.streamUrl,
          tracks: matchedTracks,
        },
        streamUrl: stream.streamUrl,
        success: true,
      };
    }
    firstError ??= stream.error;
    if (options.signal?.aborted) {
      break;
    }
  }
  return createErrorResponse(
    `No playable track found in this Spotify ${metadata.itemType}: ${firstError ?? SPOTIFY_NO_MATCH_ERROR}`
  );
}

/**
 * Resolves a Spotify link to Spotify metadata and a playable stream URL from
 * the matching YouTube upload.
 *
 * - A track link is matched and its stream returned, with the match on
 *   `metadata.youtubeVideoId` and `metadata.youtubeMatch`.
 * - An album or playlist matches only the first playable track (trying up to
 *   `firstTrackAttempts`); every other track keeps a `spotify:track:<id>`
 *   placeholder until `resolveSpotifyTrackStream` matches it on play.
 */
export async function getSpotifyItem(
  url: string,
  options: SpotifyItemOptions
): Promise<SpotifyItemResponse> {
  const resolved = await getSpotifyMetadata(url, options);
  if (!resolved.success) {
    return resolved;
  }
  const { metadata } = resolved;

  if (metadata.itemType !== "track") {
    return await matchFirstCollectionTrack(metadata, options);
  }

  const stream = await resolveSpotifyTrackStream(
    toSpotifyMatchTrack(metadata),
    {
      signal: options.signal,
      youtube: options.youtube,
    }
  );
  if (!stream.success) {
    return stream;
  }
  return {
    metadata: {
      ...metadata,
      streamUrl: stream.streamUrl,
      youtubeMatch: stream.match,
      youtubeVideoId: stream.match.videoId,
    },
    streamUrl: stream.streamUrl,
    success: true,
  };
}
