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

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".onion", ".local", ".internal"];
const BRACKETED_HOSTNAME_PATTERN = /^\[(.*)\]$/;
const TRAILING_DOTS_PATTERN = /\.+$/;
const IPV4_OCTET_PATTERN = /^\d{1,3}$/;
const IPV4_IN_IPV6_PATTERN = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/;
const IPV6_PART_PATTERN = /^[\da-f]{1,4}$/i;

export type StreamUrlValidationFailure =
  | "required"
  | "invalid-url"
  | "invalid-protocol"
  | "internal-address";

export type StreamUrlValidationResult =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; reason: StreamUrlValidationFailure };

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(BRACKETED_HOSTNAME_PATTERN, "$1")
    .replace(TRAILING_DOTS_PATTERN, "");
}

function parseIpv4Address(
  hostname: string
): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!IPV4_OCTET_PATTERN.test(part)) {
      return Number.NaN;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });

  return octets.every(Number.isInteger)
    ? (octets as [number, number, number, number])
    : null;
}

function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseIpv6Part(part: string): number | null {
  if (!IPV6_PART_PATTERN.test(part)) {
    return null;
  }
  return Number.parseInt(part, 16);
}

function parseIpv6Address(hostname: string): number[] | null {
  const ipv4Text = hostname.match(IPV4_IN_IPV6_PATTERN)?.[1];
  const embeddedIpv4 = ipv4Text ? parseIpv4Address(ipv4Text) : null;
  const normalized = embeddedIpv4
    ? hostname.replace(
        ipv4Text ?? "",
        `${(embeddedIpv4[0] * 256 + embeddedIpv4[1]).toString(16)}:${(embeddedIpv4[2] * 256 + embeddedIpv4[3]).toString(16)}`
      )
    : hostname;
  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }

  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  const words = parts.map(parseIpv6Part);
  return words.every((word): word is number => word !== null) ? words : null;
}

function ipv4FromIpv6(
  words: number[]
): [number, number, number, number] | null {
  const isMapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xff_ff;
  const isCompatible = words.slice(0, 6).every((word) => word === 0);
  if (!(isMapped || isCompatible)) {
    return null;
  }

  return [
    Math.floor(words[6] / 256),
    words[6] % 256,
    Math.floor(words[7] / 256),
    words[7] % 256,
  ];
}

function isBlockedIpv6(words: number[]): boolean {
  const embeddedIpv4 = ipv4FromIpv6(words);
  if (embeddedIpv4 && isBlockedIpv4(embeddedIpv4)) {
    return true;
  }

  const firstWord = words[0];
  return (
    words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) ||
    (firstWord >= 0xfc_00 && firstWord <= 0xfd_ff) ||
    (firstWord >= 0xfe_80 && firstWord <= 0xfe_bf) ||
    (firstWord >= 0xff_00 && firstWord <= 0xff_ff)
  );
}

export function isBlockedStreamHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const ipv4 = parseIpv4Address(normalized);
  if (ipv4) {
    return isBlockedIpv4(ipv4);
  }

  if (normalized.includes(":")) {
    const ipv6 = parseIpv6Address(normalized);
    return !ipv6 || isBlockedIpv6(ipv6);
  }

  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
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
