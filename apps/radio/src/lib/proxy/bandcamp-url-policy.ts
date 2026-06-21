const MAX_BANDCAMP_CDN_URL_LENGTH = 2048;
const BANDCAMP_CDN_HOSTNAME = "bcbits.com";
const TRAILING_DOTS_PATTERN = /\.+$/;

export type BandcampCdnUrlValidationFailure =
  | "required"
  | "invalid-url"
  | "invalid-protocol"
  | "invalid-domain";

export type BandcampCdnUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: BandcampCdnUrlValidationFailure };

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(TRAILING_DOTS_PATTERN, "");
}

export function isBandcampCdnHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === BANDCAMP_CDN_HOSTNAME ||
    normalized.endsWith(`.${BANDCAMP_CDN_HOSTNAME}`)
  );
}

export function validateBandcampCdnUrl(
  urlParam: string | null
): BandcampCdnUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  if (urlParam.length > MAX_BANDCAMP_CDN_URL_LENGTH) {
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

  if (!isBandcampCdnHostname(parsed.hostname)) {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, url: urlParam, parsed };
}
