import {
  isHostnameOrSubdomain,
  normalizePlatformHostname,
  parseHttpUrl,
} from "../url-policy/hostname.js";

export const SPOTIFY_HOST = "spotify.com";
export const SPOTIFY_OPEN_HOST = "open.spotify.com";

// `play.spotify.com` is the legacy web player; it redirects to `open`.
const SPOTIFY_PAGE_HOSTNAMES = new Set([
  "open.spotify.com",
  "play.spotify.com",
]);
// Branch.io share links: `spotify.link/<code>` redirects through
// `spotify.app.link/<code>` to an `open.spotify.com` URL.
const SPOTIFY_SHORT_LINK_HOSTNAMES = new Set([
  "spotify.link",
  "spotify.app.link",
]);

export function isSpotifyShortLinkHostname(hostname: string): boolean {
  return SPOTIFY_SHORT_LINK_HOSTNAMES.has(normalizePlatformHostname(hostname));
}

export function isSpotifyHostname(hostname: string): boolean {
  return (
    isHostnameOrSubdomain(hostname, SPOTIFY_HOST) ||
    isSpotifyShortLinkHostname(hostname)
  );
}

/** Hostnames that serve Spotify track, album and playlist pages. */
export function isSpotifyPageHostname(hostname: string): boolean {
  return SPOTIFY_PAGE_HOSTNAMES.has(normalizePlatformHostname(hostname));
}

/** HTTP(S) URLs on a Spotify or Spotify short-link host. */
export function isSpotifyHttpUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isSpotifyHostname(parsed.hostname) : false;
}
