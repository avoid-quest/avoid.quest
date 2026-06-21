import {
  isHostnameOrSubdomain,
  normalizePlatformHostname,
  parseHttpUrl,
} from "../url-policy/hostname.js";

export const SOUNDCLOUD_HOST = "soundcloud.com";
export const SOUNDCLOUD_MOBILE_HOST = "m.soundcloud.com";
export const SOUNDCLOUD_SHORT_LINK_HOST = "on.soundcloud.com";
export const MAX_SOUNDCLOUD_CDN_URL_LENGTH = 2048;

const SOUNDCLOUD_PAGE_HOSTNAMES = new Set([
  "soundcloud.com",
  "www.soundcloud.com",
]);
const SOUNDCLOUD_CDN_HOSTNAMES = new Set([
  "cf-media.sndcdn.com",
  "cf-hls-media.sndcdn.com",
  "media.soundcloud.com",
  "ec-media.sndcdn.com",
]);
const SOUNDCLOUD_CORS_ALLOWED_CDN_HOSTNAMES = new Set([
  "cf-hls-media.sndcdn.com",
]);

export type SoundCloudCdnUrlValidationFailure =
  | "required"
  | SoundCloudCdnRedirectUrlValidationFailure;

export type SoundCloudCdnRedirectUrlValidationFailure =
  | "invalid-url"
  | "invalid-protocol"
  | "page-url"
  | "invalid-domain";

export type SoundCloudCdnUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: SoundCloudCdnUrlValidationFailure };

export type SoundCloudCdnRedirectUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: SoundCloudCdnRedirectUrlValidationFailure };

export function isSoundCloudHostname(hostname: string): boolean {
  return isHostnameOrSubdomain(hostname, SOUNDCLOUD_HOST);
}

export function isSoundCloudMobileHostname(hostname: string): boolean {
  return normalizePlatformHostname(hostname) === SOUNDCLOUD_MOBILE_HOST;
}

export function isSoundCloudShortLinkHostname(hostname: string): boolean {
  return normalizePlatformHostname(hostname) === SOUNDCLOUD_SHORT_LINK_HOST;
}

export function isSoundCloudPageHostname(hostname: string): boolean {
  return SOUNDCLOUD_PAGE_HOSTNAMES.has(normalizePlatformHostname(hostname));
}

export function isSoundCloudCdnHostname(hostname: string): boolean {
  return SOUNDCLOUD_CDN_HOSTNAMES.has(normalizePlatformHostname(hostname));
}

export function isSoundCloudCorsAllowedCdnHostname(hostname: string): boolean {
  return SOUNDCLOUD_CORS_ALLOWED_CDN_HOSTNAMES.has(
    normalizePlatformHostname(hostname)
  );
}

export function isSoundCloudUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isSoundCloudHostname(parsed.hostname) : false;
}

export function validateSoundCloudCdnRedirectUrl(
  url: string
): SoundCloudCdnRedirectUrlValidationResult {
  if (url.length > MAX_SOUNDCLOUD_CDN_URL_LENGTH) {
    return { ok: false, reason: "invalid-url" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid-protocol" };
  }

  if (isSoundCloudPageHostname(parsed.hostname)) {
    return { ok: false, reason: "page-url" };
  }

  if (!isSoundCloudCdnHostname(parsed.hostname)) {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, url, parsed };
}

export function validateSoundCloudCdnUrl(
  urlParam: string | null
): SoundCloudCdnUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  return validateSoundCloudCdnRedirectUrl(urlParam);
}
