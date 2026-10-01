import { parseHttpUrl } from "../url-policy/hostname.js";
import type { SpotifyItemType } from "./types.js";
import {
  isSpotifyHttpUrl,
  isSpotifyPageHostname,
  isSpotifyShortLinkHostname,
  SPOTIFY_OPEN_HOST,
} from "./url-policy.js";

export type SpotifyRef = {
  type: SpotifyItemType;
  id: string;
};

const SPOTIFY_ID_PATTERN = /^[0-9A-Za-z]{22}$/;
const SPOTIFY_URI_PATTERN = /^spotify:/i;
const SPOTIFY_TRACK_PLACEHOLDER_PATTERN = /^spotify:track:([0-9A-Za-z]{22})$/;
const INTL_SEGMENT_PATTERN = /^intl-[a-z]{2}(?:-[a-z0-9]{2,4})?$/i;
const SHORT_LINK_PATH_PATTERN = /^\/[A-Za-z0-9]+\/?$/;

const ITEM_TYPES: ReadonlySet<string> = new Set<SpotifyItemType>([
  "album",
  "playlist",
  "track",
]);

function toRef(type: string | undefined, id: string | undefined) {
  if (
    !(
      type &&
      id &&
      ITEM_TYPES.has(type.toLowerCase()) &&
      SPOTIFY_ID_PATTERN.test(id)
    )
  ) {
    return null;
  }
  return { id, type: type.toLowerCase() as SpotifyItemType };
}

// `spotify:track:<id>`, `spotify:album:<id>`, `spotify:playlist:<id>` and the
// legacy `spotify:user:<user>:playlist:<id>`.
function parseSpotifyUri(uri: string): SpotifyRef | null {
  const parts = uri.split(":");
  if (parts.length === 3) {
    return toRef(parts[1], parts[2]);
  }
  if (parts.length === 5 && parts[1]?.toLowerCase() === "user") {
    return parts[3]?.toLowerCase() === "playlist"
      ? toRef(parts[3], parts[4])
      : null;
  }
  return null;
}

// `/track/<id>`, `/intl-de/album/<id>`, `/embed/playlist/<id>` and the legacy
// `/user/<user>/playlist/<id>`.
function parseSpotifyPath(pathname: string): SpotifyRef | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] && INTL_SEGMENT_PATTERN.test(segments[0])) {
    segments.shift();
  }
  if (segments[0]?.toLowerCase() === "embed") {
    segments.shift();
  }
  if (segments.length === 4 && segments[0]?.toLowerCase() === "user") {
    return segments[2]?.toLowerCase() === "playlist"
      ? toRef(segments[2], segments[3])
      : null;
  }
  return segments.length === 2 ? toRef(segments[0], segments[1]) : null;
}

/**
 * Parses a Spotify track, album or playlist link or URI. Artists, shows,
 * episodes, short links and other pages return null.
 */
export function parseSpotifyRef(input: string): SpotifyRef | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (SPOTIFY_URI_PATTERN.test(value)) {
    return parseSpotifyUri(value);
  }
  const parsed = parseHttpUrl(value);
  if (!(parsed && isSpotifyPageHostname(parsed.hostname))) {
    return null;
  }
  return parseSpotifyPath(parsed.pathname);
}

/** Any Spotify web or short link, or a `spotify:` URI. */
export function isSpotifyUrl(url: string): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }
  const value = url.trim();
  return SPOTIFY_URI_PATTERN.test(value) || isSpotifyHttpUrl(value);
}

/** A `spotify.link` share link, which must be resolved before parsing. */
export function needsSpotifyResolution(url: string): boolean {
  const parsed = parseHttpUrl(url.trim());
  return (
    parsed !== null &&
    isSpotifyShortLinkHostname(parsed.hostname) &&
    SHORT_LINK_PATH_PATTERN.test(parsed.pathname)
  );
}

export function detectSpotifyItemType(url: string): SpotifyItemType | null {
  return parseSpotifyRef(url)?.type ?? null;
}

export function getSpotifyUrl({ id, type }: SpotifyRef): string {
  return `https://${SPOTIFY_OPEN_HOST}/${type}/${id}`;
}

export function getSpotifyUri({ id, type }: SpotifyRef): string {
  return `spotify:${type}:${id}`;
}

/**
 * Rewrites any parseable Spotify link or URI to the canonical
 * `https://open.spotify.com/<type>/<id>`, dropping `?si=` and locale
 * prefixes. Other URLs are returned as is.
 */
export function normalizeSpotifyUrl(url: string): string {
  const ref = parseSpotifyRef(url);
  return ref ? getSpotifyUrl(ref) : url;
}

/** The `streamUrl` of a collection track that has not been matched yet. */
export function getSpotifyTrackPlaceholder(spotifyId: string): string {
  return getSpotifyUri({ id: spotifyId, type: "track" });
}

/** The Spotify track id of an unmatched track's `streamUrl`, if it is one. */
export function parseSpotifyTrackPlaceholder(streamUrl: string): string | null {
  return SPOTIFY_TRACK_PLACEHOLDER_PATTERN.exec(streamUrl)?.[1] ?? null;
}
