const MAX_STREAM_URL_LENGTH = 2048;

function parseUrl(value: string): URL | null {
  if (value.length > MAX_STREAM_URL_LENGTH) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const BLOCKED_HOSTNAMES = [
  "localhost",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
];

const BLOCKED_HOSTNAME_SUFFIXES = [".onion", ".local", ".internal"];

const BLOCKED_HOSTNAME_PREFIXES = [
  "127.",
  "10.",
  "192.168.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "169.254.",
  "fc",
  "fd",
  "fe80:",
  "::ffff:127.",
  "::ffff:10.",
  "::ffff:192.168.",
  "::ffff:172.16.",
  "::ffff:172.17.",
  "::ffff:172.18.",
  "::ffff:172.19.",
  "::ffff:172.20.",
  "::ffff:172.21.",
  "::ffff:172.22.",
  "::ffff:172.23.",
  "::ffff:172.24.",
  "::ffff:172.25.",
  "::ffff:172.26.",
  "::ffff:172.27.",
  "::ffff:172.28.",
  "::ffff:172.29.",
  "::ffff:172.30.",
  "::ffff:172.31.",
  "::ffff:169.254.",
];

export type StreamUrlValidationFailure =
  | "required"
  | "invalid-url"
  | "invalid-protocol"
  | "internal-address";

export type StreamUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: StreamUrlValidationFailure };

export function isBlockedStreamHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    BLOCKED_HOSTNAMES.includes(normalized) ||
    BLOCKED_HOSTNAME_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

export function validatePublicStreamUrl(
  urlParam: string | null
): StreamUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  const parsed = parseUrl(urlParam);
  if (!parsed) {
    return { ok: false, reason: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid-protocol" };
  }

  if (isBlockedStreamHostname(parsed.hostname)) {
    return { ok: false, reason: "internal-address" };
  }

  return { ok: true, url: urlParam, parsed };
}

export function isPublicHttpUrl(value: string): boolean {
  const validation = validatePublicStreamUrl(value);
  return validation.ok;
}
