import type { SoundCloudItemType } from "./types.js";

const SOUNDCLOUD_HOST = "soundcloud.com";
const SOUNDCLOUD_HOST_SUFFIX = ".soundcloud.com";
const SOUNDCLOUD_MOBILE_HOST = "m.soundcloud.com";
const SOUNDCLOUD_SHORT_LINK_HOST = "on.soundcloud.com";
const SOUNDCLOUD_SHORT_LINK_PATH = /^\/[a-zA-Z0-9]+\/?$/;
const TRAILING_DOTS_PATTERN = /\.+$/;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

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

function isSoundCloudHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === SOUNDCLOUD_HOST ||
    normalized.endsWith(SOUNDCLOUD_HOST_SUFFIX)
  );
}

export function isSoundCloudUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isSoundCloudHostname(parsed.hostname) : false;
}

/**
 * Check if URL is a SoundCloud short link that needs resolution
 */
export function needsResolution(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }

  return (
    normalizeHostname(parsed.hostname) === SOUNDCLOUD_SHORT_LINK_HOST &&
    SOUNDCLOUD_SHORT_LINK_PATH.test(parsed.pathname)
  );
}

/**
 * Normalize SoundCloud URL (converts mobile URLs to desktop)
 */
export function normalizeSoundCloudUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (
    !parsed ||
    normalizeHostname(parsed.hostname) !== SOUNDCLOUD_MOBILE_HOST
  ) {
    return url;
  }

  parsed.hostname = SOUNDCLOUD_HOST;
  return parsed.toString();
}

export function detectSoundCloudItemType(url: string): SoundCloudItemType {
  if (SOUNDCLOUD_PLAYLIST_PATTERN.test(url)) {
    return "playlist";
  }
  if (SOUNDCLOUD_TRACK_PATTERN.test(url)) {
    return "track";
  }
  return "user";
}
