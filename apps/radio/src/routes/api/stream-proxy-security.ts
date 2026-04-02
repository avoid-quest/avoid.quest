import { AppError } from "@avoid.quest/error";

const MAX_REDIRECTS = 5;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_STREAM_DURATION_MS = 15 * 60_000;
const DEFAULT_MAX_STREAM_BYTES = 100 * 1024 * 1024;

const LOCAL_ONLY_HOSTNAMES = new Set([
  "localhost",
  "localhost.",
  "0.0.0.0",
  "::",
  "::1",
]);

const BLOCKED_HOST_SUFFIXES = [".onion", ".local", ".internal"];
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal"]);

function parseInteger(raw: string): number | null {
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    return Number.parseInt(raw.slice(2), 16);
  }

  if (/^0[0-7]+$/.test(raw) && raw.length > 1) {
    return Number.parseInt(raw, 8);
  }

  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  return null;
}

function parseIpv4(hostname: string): number[] | null {
  const host = hostname.trim().toLowerCase();
  if (!host) return null;

  const dotParts = host.split(".");
  if (dotParts.length === 4) {
    const octets = dotParts.map((part) => parseInteger(part));
    if (octets.some((octet) => octet === null || octet < 0 || octet > 255)) {
      return null;
    }
    return octets as number[];
  }

  const numericHost = parseInteger(host);
  if (numericHost === null || numericHost < 0 || numericHost > 0xffffffff) {
    return null;
  }

  return [
    (numericHost >>> 24) & 255,
    (numericHost >>> 16) & 255,
    (numericHost >>> 8) & 255,
    numericHost & 255,
  ];
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function normalizeHostname(rawHostname: string): string {
  let hostname = rawHostname.trim().toLowerCase();

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (hostname.endsWith(".")) {
    hostname = hostname.slice(0, -1);
  }

  return hostname;
}

function isPrivateIpv6(hostname: string): boolean {
  const host = normalizeHostname(hostname);

  if (host === "::1" || host === "::") {
    return true;
  }

  if (host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  if (
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb")
  ) {
    return true;
  }

  if (!host.startsWith("::ffff:")) {
    return false;
  }

  const mapped = host.slice("::ffff:".length);
  const mappedIpv4 = parseIpv4(mapped);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  const hexPair = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexPair) {
    return false;
  }

  const hi = Number.parseInt(hexPair[1], 16);
  const lo = Number.parseInt(hexPair[2], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) {
    return false;
  }

  const octets = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
  return isPrivateIpv4(octets);
}

export function parseAllowedDomainPatterns(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

export function isAllowedByDomainPolicy(
  hostname: string,
  allowedPatterns: string[]
): boolean {
  if (allowedPatterns.length === 0) {
    return true;
  }

  const host = normalizeHostname(hostname);
  return allowedPatterns.some(
    (pattern) => host === pattern || host.endsWith(`.${pattern}`)
  );
}

export function getStreamProxyConfig(sourceEnv: unknown) {
  const envRecord = (sourceEnv ?? {}) as Record<string, string | undefined>;

  return {
    allowedDomains: parseAllowedDomainPatterns(
      envRecord.STREAM_PROXY_ALLOWED_DOMAINS
    ),
    upstreamTimeoutMs:
      Number.parseInt(envRecord.STREAM_PROXY_UPSTREAM_TIMEOUT_MS ?? "", 10) ||
      DEFAULT_UPSTREAM_TIMEOUT_MS,
    maxStreamDurationMs:
      Number.parseInt(envRecord.STREAM_PROXY_MAX_DURATION_MS ?? "", 10) ||
      DEFAULT_MAX_STREAM_DURATION_MS,
    maxStreamBytes:
      Number.parseInt(envRecord.STREAM_PROXY_MAX_BYTES ?? "", 10) ||
      DEFAULT_MAX_STREAM_BYTES,
  };
}

/**
 * Block list coverage (secure-by-default + compatibility fallback):
 * - Local/dev aliases: localhost, 0.0.0.0, ::, ::1
 * - Private/link-local IPv4 CIDRs: 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16
 * - Private/link-local IPv6 ranges: ::1, fc00::/7, fe80::/10
 * - IPv4-mapped IPv6 (including hexadecimal tail forms)
 * - Special-use internal hostnames and suffixes: metadata.google.internal, .local, .internal, .onion
 * - Less-common numeric IPv4 encodings (single-integer, octal, hex)
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);

  if (LOCAL_ONLY_HOSTNAMES.has(host) || BLOCKED_HOSTNAMES.has(host)) {
    return true;
  }

  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    return true;
  }

  return isPrivateIpv6(host);
}

export async function fetchWithValidatedRedirects(
  initialUrl: string,
  headers: HeadersInit,
  signal: AbortSignal,
  allowedDomains: string[]
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) {
        throw new AppError({
          code: "STREAM_PROXY_REDIRECT_INVALID",
          safeMessage: "Invalid redirect response from upstream",
          category: "dependency",
          expected: false,
          status: 502,
        });
      }

      const nextUrl = new URL(location, currentUrl);
      if (
        isBlockedHostname(nextUrl.hostname) ||
        !isAllowedByDomainPolicy(nextUrl.hostname, allowedDomains)
      ) {
        throw new AppError({
          code: "STREAM_PROXY_REDIRECT_BLOCKED",
          safeMessage: "Redirect target is blocked",
          category: "security",
          expected: true,
          status: 403,
        });
      }

      currentUrl = nextUrl.toString();
      continue;
    }

    return response;
  }

  throw new AppError({
    code: "STREAM_PROXY_TOO_MANY_REDIRECTS",
    safeMessage: "Too many upstream redirects",
    category: "dependency",
    expected: false,
    status: 502,
  });
}
