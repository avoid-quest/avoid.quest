import {
  isHostnameOrSubdomain,
  normalizePlatformHostname,
  parseHttpUrl,
} from "../url-policy/hostname.js";

export const MIXCLOUD_HOST = "mixcloud.com";
export const MIXCLOUD_CANONICAL_HOST = "www.mixcloud.com";
export const MAX_MIXCLOUD_STREAM_URL_LENGTH = 2048;

const MIXCLOUD_PAGE_HOSTNAMES = new Set([
  "mixcloud.com",
  "www.mixcloud.com",
  "m.mixcloud.com",
  "beta.mixcloud.com",
]);
// `dl` serves progressive M4A, `aod` serves HLS and DASH.
const MIXCLOUD_STREAM_HOSTNAMES = new Set([
  "dl.mixcloud.stream",
  "aod.mixcloud.stream",
]);

export type MixcloudStreamUrlValidationFailure =
  | "required"
  | "invalid-url"
  | "invalid-protocol"
  | "invalid-domain";

export type MixcloudStreamUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: MixcloudStreamUrlValidationFailure };

export function isMixcloudHostname(hostname: string): boolean {
  return isHostnameOrSubdomain(hostname, MIXCLOUD_HOST);
}

/** Hostnames that serve Mixcloud show pages. */
export function isMixcloudPageHostname(hostname: string): boolean {
  return MIXCLOUD_PAGE_HOSTNAMES.has(normalizePlatformHostname(hostname));
}

export function isMixcloudStreamHostname(hostname: string): boolean {
  return MIXCLOUD_STREAM_HOSTNAMES.has(normalizePlatformHostname(hostname));
}

export function isMixcloudUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isMixcloudHostname(parsed.hostname) : false;
}

/** Accepts only HTTPS URLs on Mixcloud's audio stream hosts. */
export function validateMixcloudStreamUrl(
  url: string | null
): MixcloudStreamUrlValidationResult {
  if (!url) {
    return { ok: false, reason: "required" };
  }

  if (url.length > MAX_MIXCLOUD_STREAM_URL_LENGTH) {
    return { ok: false, reason: "invalid-url" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid-protocol" };
  }

  if (!isMixcloudStreamHostname(parsed.hostname)) {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, parsed, url };
}
