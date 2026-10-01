import { parseHttpUrl } from "../url-policy/hostname.js";
import {
  isMixcloudPageHostname,
  MIXCLOUD_CANONICAL_HOST,
} from "./url-policy.js";

export { isMixcloudUrl } from "./url-policy.js";

export type MixcloudShowRef = {
  username: string;
  slug: string;
};

const MAX_SEGMENT_LENGTH = 200;
const INVALID_SEGMENT_PATTERN = /[\s/?#]/u;

// Top-level paths that are site sections, not user profiles.
const RESERVED_ROOT_SEGMENTS = new Set([
  "about",
  "categories",
  "dashboard",
  "developers",
  "discover",
  "genres",
  "live",
  "messages",
  "notifications",
  "player",
  "pro",
  "search",
  "select",
  "settings",
  "tag",
  "upload",
  "widget",
]);

// Second path segments that are profile tabs, not shows.
const RESERVED_PROFILE_SECTIONS = new Set([
  "activity",
  "favorites",
  "followers",
  "following",
  "hosts",
  "listens",
  "playlists",
  "reposts",
  "stream",
  "uploads",
]);

function decodeSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.length > MAX_SEGMENT_LENGTH ||
    INVALID_SEGMENT_PATTERN.test(decoded)
  ) {
    return null;
  }
  return decoded;
}

/**
 * Parses a Mixcloud show URL (`mixcloud.com/<user>/<show>/`). Profiles,
 * profile tabs, playlists and site sections return null.
 */
export function parseMixcloudShowUrl(url: string): MixcloudShowRef | null {
  const parsed = parseHttpUrl(url);
  if (!(parsed && isMixcloudPageHostname(parsed.hostname))) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }

  const [rawUsername = "", rawSlug = ""] = segments;
  const username = decodeSegment(rawUsername);
  const slug = decodeSegment(rawSlug);
  if (!(username && slug)) {
    return null;
  }

  if (
    RESERVED_ROOT_SEGMENTS.has(username.toLowerCase()) ||
    RESERVED_PROFILE_SECTIONS.has(slug.toLowerCase())
  ) {
    return null;
  }

  return { slug, username };
}

export function isMixcloudShowUrl(url: string): boolean {
  return parseMixcloudShowUrl(url) !== null;
}

export function getMixcloudShowUrl({
  slug,
  username,
}: MixcloudShowRef): string {
  return `https://${MIXCLOUD_CANONICAL_HOST}/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/`;
}

/**
 * Rewrites a show URL on any Mixcloud page host to the canonical
 * `https://www.mixcloud.com/<user>/<show>/`. Other URLs are returned as is.
 */
export function normalizeMixcloudUrl(url: string): string {
  const show = parseMixcloudShowUrl(url);
  return show ? getMixcloudShowUrl(show) : url;
}
