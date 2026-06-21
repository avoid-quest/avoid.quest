import type { BandcampItemType } from "./types.js";

const BANDCAMP_HOST = "bandcamp.com";
const BANDCAMP_HOST_SUFFIX = ".bandcamp.com";
const BANDCAMP_MOBILE_HOST = "m.bandcamp.com";
const TRAILING_DOTS_PATTERN = /\.+$/;
const BANDCAMP_ALBUM_PATTERN = /bandcamp\.com\/album\//i;
const BANDCAMP_TRACK_PATTERN = /bandcamp\.com\/track\//i;
const BANDCAMP_LABEL_PATTERN = /bandcamp\.com\/label\//i;
// Collection URLs: bandcamp.com/username or bandcamp.com/username/collection|wishlist
// Must NOT match subdomain patterns like artist.bandcamp.com
const BANDCAMP_COLLECTION_PATTERN =
  /^https?:\/\/(www\.)?bandcamp\.com\/[a-zA-Z0-9_-]+(?:\/(collection|wishlist|following|followers))?(?:\/)?$/i;
// Artist pages: subdomain.bandcamp.com (with optional /music path)
const BANDCAMP_ARTIST_PATTERN =
  /^https?:\/\/[a-zA-Z0-9_-]+\.bandcamp\.com(?:\/music)?(?:\/)?$/i;

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(TRAILING_DOTS_PATTERN, "");
}

function isBandcampHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === BANDCAMP_HOST || normalized.endsWith(BANDCAMP_HOST_SUFFIX)
  );
}

export function isBandcampUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isBandcampHostname(parsed.hostname) : false;
}

/**
 * Normalize Bandcamp URL (converts mobile URLs to desktop)
 */
export function normalizeBandcampUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed || normalizeHostname(parsed.hostname) !== BANDCAMP_MOBILE_HOST) {
    return url;
  }

  parsed.hostname = BANDCAMP_HOST;
  return parsed.toString();
}

/**
 * HTML markers that indicate a page is a Bandcamp embed (for custom domain detection)
 */
export const BANDCAMP_HTML_MARKERS = [
  "data-tralbum",
  "bandcamp.com/js/",
  'og:site_name" content="Bandcamp',
] as const;

/**
 * Detect if HTML content is from a Bandcamp page (for custom domain detection)
 */
export function detectBandcampFromHtml(html: string): boolean {
  return BANDCAMP_HTML_MARKERS.some((marker) => html.includes(marker));
}

export function detectBandcampItemType(url: string): BandcampItemType {
  if (BANDCAMP_ALBUM_PATTERN.test(url)) {
    return "album";
  }
  if (BANDCAMP_TRACK_PATTERN.test(url)) {
    return "track";
  }
  if (BANDCAMP_LABEL_PATTERN.test(url)) {
    return "label";
  }
  if (BANDCAMP_COLLECTION_PATTERN.test(url)) {
    return "collection";
  }
  if (BANDCAMP_ARTIST_PATTERN.test(url)) {
    return "artist";
  }
  // Default to artist for subdomain patterns
  return "artist";
}
