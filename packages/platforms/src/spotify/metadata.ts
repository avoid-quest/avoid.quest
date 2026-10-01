import { load } from "cheerio";
import {
  getSpotifyTrackPlaceholder,
  getSpotifyUrl,
  parseSpotifyRef,
  type SpotifyRef,
} from "./detect.js";
import type {
  SpotifyItemError,
  SpotifyMetadata,
  SpotifyMetadataResponse,
  SpotifyTrackInfo,
} from "./types.js";

export const SPOTIFY_EMBED_BASE_URL = "https://open.spotify.com/embed";

const OG_DESCRIPTION_SEPARATOR = " · ";
const MS_PER_SECOND = 1000;

type SpotifyEmbedImage = {
  url?: string | null;
  maxWidth?: number | null;
  width?: number | null;
};

export type SpotifyEmbedTrack = {
  uri?: string | null;
  title?: string | null;
  subtitle?: string | null;
  duration?: number | null;
  entityType?: string | null;
};

export type SpotifyEmbedEntity = {
  type?: string | null;
  id?: string | null;
  name?: string | null;
  title?: string | null;
  subtitle?: string | null;
  artists?: { name?: string | null }[] | null;
  duration?: number | null;
  visualIdentity?: { image?: SpotifyEmbedImage[] | null } | null;
  coverArt?: { sources?: SpotifyEmbedImage[] | null } | null;
  trackList?: SpotifyEmbedTrack[] | null;
};

type SpotifyEmbedData = {
  props?: {
    pageProps?: {
      status?: number;
      state?: { data?: { entity?: SpotifyEmbedEntity | null } | null } | null;
    } | null;
  } | null;
};

function createErrorResponse(message: string): SpotifyItemError {
  return { error: message, success: false };
}

function toSeconds(
  milliseconds: number | null | undefined
): number | undefined {
  return typeof milliseconds === "number" && milliseconds > 0
    ? milliseconds / MS_PER_SECOND
    : undefined;
}

function largestImage(
  images: SpotifyEmbedImage[] | null | undefined
): string | undefined {
  let best: { url: string; width: number } | undefined;
  for (const image of images ?? []) {
    if (!image.url) {
      continue;
    }
    const width = image.maxWidth ?? image.width ?? 0;
    if (!best || width > best.width) {
      best = { url: image.url, width };
    }
  }
  return best?.url;
}

function entityArtwork(entity: SpotifyEmbedEntity): string | undefined {
  return (
    largestImage(entity.visualIdentity?.image) ??
    largestImage(entity.coverArt?.sources)
  );
}

function readEmbedData(html: string): SpotifyEmbedData | null {
  const json = load(html)("script#__NEXT_DATA__").first().text();
  if (!json.trim()) {
    return null;
  }
  try {
    return JSON.parse(json) as SpotifyEmbedData;
  } catch {
    return null;
  }
}

function toTrackInfo(
  track: SpotifyEmbedTrack,
  collection: { album?: string; artwork?: string }
): SpotifyTrackInfo | null {
  const ref = track.uri ? parseSpotifyRef(track.uri) : null;
  const name = track.title?.trim();
  if (!(ref?.type === "track" && name)) {
    return null;
  }
  return {
    album: collection.album,
    artist: track.subtitle?.trim() || "Unknown Artist",
    duration: toSeconds(track.duration),
    name,
    spotifyId: ref.id,
    streamUrl: getSpotifyTrackPlaceholder(ref.id),
    thumbnail: collection.artwork,
    url: getSpotifyUrl(ref),
  };
}

function trackMetadata(
  ref: SpotifyRef,
  entity: SpotifyEmbedEntity
): SpotifyMetadata {
  const artists = (entity.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    artist: artists.join(", ") || undefined,
    artists,
    artwork: entityArtwork(entity),
    duration: toSeconds(entity.duration),
    itemType: "track",
    name: entity.name?.trim() || entity.title?.trim() || undefined,
    platform: "spotify",
    spotifyId: ref.id,
    url: getSpotifyUrl(ref),
  };
}

function collectionMetadata(
  ref: SpotifyRef,
  entity: SpotifyEmbedEntity
): SpotifyMetadata {
  const name = entity.name?.trim() || entity.title?.trim() || undefined;
  const artwork = entityArtwork(entity);
  const tracks = (entity.trackList ?? [])
    .map((track) =>
      toTrackInfo(track, {
        album: ref.type === "album" ? name : undefined,
        artwork: ref.type === "album" ? artwork : undefined,
      })
    )
    .filter((track): track is SpotifyTrackInfo => track !== null);
  const durationMs = tracks.reduce(
    (total, track) => total + Math.round((track.duration ?? 0) * MS_PER_SECOND),
    0
  );
  return {
    album: ref.type === "album" ? name : undefined,
    artist: entity.subtitle?.trim() || undefined,
    artwork,
    duration: toSeconds(durationMs),
    itemType: ref.type,
    name,
    platform: "spotify",
    spotifyId: ref.id,
    trackCount: tracks.length,
    tracks,
    url: getSpotifyUrl(ref),
  };
}

/**
 * Turns an `open.spotify.com/embed/<type>/<id>` page into metadata. Pure, so
 * recorded pages can be tested without the network.
 */
export function parseSpotifyEmbedPage(
  ref: SpotifyRef,
  html: string
): SpotifyMetadataResponse {
  const pageProps = readEmbedData(html)?.props?.pageProps;
  if (!pageProps) {
    return createErrorResponse("Unexpected Spotify embed page");
  }
  const entity = pageProps.state?.data?.entity;
  if (!entity) {
    return createErrorResponse(
      pageProps.status === 404
        ? `Spotify ${ref.type} not found`
        : "Unexpected Spotify embed page"
    );
  }
  if (entity.type !== ref.type || (entity.id && entity.id !== ref.id)) {
    return createErrorResponse("Unexpected Spotify embed page");
  }

  if (ref.type === "track") {
    const metadata = trackMetadata(ref, entity);
    return metadata.name
      ? { metadata, success: true }
      : createErrorResponse("Unexpected Spotify embed page");
  }

  const metadata = collectionMetadata(ref, entity);
  if (!metadata.tracks?.length) {
    return createErrorResponse(`This Spotify ${ref.type} has no tracks`);
  }
  return { metadata, success: true };
}

/**
 * The album name from a track page's `og:description`, which reads
 * "<artists> · <album> · Song · <year>" for English pages.
 */
export function parseSpotifyTrackPageAlbum(html: string): string | undefined {
  const description = load(html)('meta[property="og:description"]')
    .first()
    .attr("content");
  if (!description) {
    return undefined;
  }
  const parts = description.split(OG_DESCRIPTION_SEPARATOR);
  if (parts.length < 4 || parts.at(-2) !== "Song") {
    return undefined;
  }
  return parts.slice(1, -2).join(OG_DESCRIPTION_SEPARATOR).trim() || undefined;
}
