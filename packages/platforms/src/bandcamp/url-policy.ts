import {
  isHostnameOrSubdomain,
  normalizePlatformHostname,
  parseHttpUrl,
} from "../url-policy/hostname.js";

export const BANDCAMP_HOST = "bandcamp.com";
export const BANDCAMP_MOBILE_HOST = "m.bandcamp.com";
export const BANDCAMP_CDN_HOST = "bcbits.com";
export const MAX_BANDCAMP_CDN_URL_LENGTH = 2048;

export type BandcampCdnUrlValidationFailure =
  | "required"
  | BandcampCdnRedirectUrlValidationFailure;

export type BandcampCdnRedirectUrlValidationFailure =
  | "invalid-url"
  | "invalid-protocol"
  | "invalid-domain";

export type BandcampCdnUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: BandcampCdnUrlValidationFailure };

export type BandcampCdnRedirectUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: BandcampCdnRedirectUrlValidationFailure };

export function isBandcampHostname(hostname: string): boolean {
  return isHostnameOrSubdomain(hostname, BANDCAMP_HOST);
}

export function isBandcampMobileHostname(hostname: string): boolean {
  return normalizePlatformHostname(hostname) === BANDCAMP_MOBILE_HOST;
}

export function isBandcampCdnHostname(hostname: string): boolean {
  return isHostnameOrSubdomain(hostname, BANDCAMP_CDN_HOST);
}

export function isBandcampUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isBandcampHostname(parsed.hostname) : false;
}

export function validateBandcampCdnRedirectUrl(
  url: string
): BandcampCdnRedirectUrlValidationResult {
  if (url.length > MAX_BANDCAMP_CDN_URL_LENGTH) {
    return { ok: false, reason: "invalid-url" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "invalid-url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid-protocol" };
  }

  if (!isBandcampCdnHostname(parsed.hostname)) {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, parsed, url };
}

export function validateBandcampCdnUrl(
  urlParam: string | null
): BandcampCdnUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  return validateBandcampCdnRedirectUrl(urlParam);
}
