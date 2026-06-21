const MAX_SOUNDCLOUD_CDN_URL_LENGTH = 2048;
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
const TRAILING_DOTS_PATTERN = /\.+$/;

export type SoundCloudCdnUrlValidationFailure =
  | "required"
  | "invalid-url"
  | "invalid-protocol"
  | "page-url"
  | "invalid-domain";

export type SoundCloudCdnUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: SoundCloudCdnUrlValidationFailure };

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(TRAILING_DOTS_PATTERN, "");
}

export function isSoundCloudPageHostname(hostname: string): boolean {
  return SOUNDCLOUD_PAGE_HOSTNAMES.has(normalizeHostname(hostname));
}

export function isSoundCloudCdnHostname(hostname: string): boolean {
  return SOUNDCLOUD_CDN_HOSTNAMES.has(normalizeHostname(hostname));
}

export function validateSoundCloudCdnUrl(
  urlParam: string | null
): SoundCloudCdnUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  if (urlParam.length > MAX_SOUNDCLOUD_CDN_URL_LENGTH) {
    return { ok: false, reason: "invalid-url" };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlParam);
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

  return { ok: true, url: urlParam, parsed };
}
