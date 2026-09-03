import {
  type FetchLike,
  fetchWithValidatedRedirectResult,
  type ValidatedRedirectFailure,
  type ValidatedRedirectResult,
} from "../redirects/index.js";

const MAX_PUBLIC_HTTP_URL_LENGTH = 4096;
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".onion",
  ".local",
  ".internal",
];
const BRACKETED_HOSTNAME_PATTERN = /^\[(.*)\]$/;
const TRAILING_DOTS_PATTERN = /\.+$/;
const IPV4_OCTET_PATTERN = /^\d{1,3}$/;
const IPV4_IN_IPV6_PATTERN = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/;
const IPV6_PART_PATTERN = /^[\da-f]{1,4}$/i;
const PUBLIC_DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_RECORD_TYPES = {
  A: 1,
  AAAA: 28,
} as const;
const DNS_SUCCESS_STATUS = 0;
const DNS_NAME_NOT_FOUND_STATUS = 3;

export type PublicHttpUrlFailure =
  | "invalid-url"
  | "invalid-protocol"
  | "internal-address"
  | "hostname-resolution-failed";

export type PublicHttpUrlValidationFailure = "required" | PublicHttpUrlFailure;

type PublicHttpUrlSuccess = { ok: true; url: string; parsed: URL };

export type PublicHttpUrlResult =
  | PublicHttpUrlSuccess
  | { ok: false; reason: PublicHttpUrlFailure };

export type PublicHttpUrlValidationResult =
  | PublicHttpUrlSuccess
  | { ok: false; reason: PublicHttpUrlValidationFailure };

export type PublicHttpRedirectFailure =
  ValidatedRedirectFailure<PublicHttpUrlFailure>;

export type PublicHttpFetchResult =
  ValidatedRedirectResult<PublicHttpUrlFailure>;

type FetchPublicHttpUrlOptions = {
  fetchImpl: FetchLike;
  init?: RequestInit;
  maxRedirects?: number;
  resolveHostname?: PublicHostnameResolver | false;
  url: string;
};

export type PublicHostnameResolver = (
  hostname: string,
  options?: PublicHostnameResolutionOptions
) => Promise<readonly string[]>;

export function cachePublicHostnameResolver(
  resolveHostname: PublicHostnameResolver
): PublicHostnameResolver {
  const resolutions = new Map<string, Promise<readonly string[]>>();
  return (hostname, options) => {
    const cached = resolutions.get(hostname);
    if (cached) {
      return cached;
    }
    const pending = resolveHostname(hostname, options);
    resolutions.set(hostname, pending);
    pending.catch(() => resolutions.delete(hostname));
    return pending;
  };
}

type PublicHostnameResolutionOptions = {
  signal?: AbortSignal;
};

type ValidateResolvedPublicHttpUrlOptions = {
  resolveHostname?: PublicHostnameResolver | false;
  signal?: AbortSignal;
};

type DnsJsonRecordType = keyof typeof DNS_RECORD_TYPES;

type DnsJsonAnswer = {
  data?: unknown;
  type?: unknown;
};

type DnsJsonResponse = {
  Answer?: DnsJsonAnswer[];
  Status?: unknown;
};

function parseUrl(value: string): URL | null {
  if (value.length > MAX_PUBLIC_HTTP_URL_LENGTH) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

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

function isIpAddress(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    parseIpv4Address(normalized) !== null ||
    parseIpv6Address(normalized) !== null
  );
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
        `${(embeddedIpv4[0] * 256 + embeddedIpv4[1]).toString(16)}:${(
          embeddedIpv4[2] * 256 + embeddedIpv4[3]
        ).toString(16)}`
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

  const [, , , , , , word6, word7] = words;
  if (word6 === undefined || word7 === undefined) {
    return null;
  }

  return [
    Math.floor(word6 / 256),
    word6 % 256,
    Math.floor(word7 / 256),
    word7 % 256,
  ];
}

function isBlockedIpv6(words: number[]): boolean {
  const embeddedIpv4 = ipv4FromIpv6(words);
  if (embeddedIpv4 && isBlockedIpv4(embeddedIpv4)) {
    return true;
  }

  const [firstWord] = words;
  if (firstWord === undefined) {
    return true;
  }

  return (
    words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) ||
    (firstWord >= 0xfc_00 && firstWord <= 0xfd_ff) ||
    (firstWord >= 0xfe_80 && firstWord <= 0xfe_bf) ||
    (firstWord >= 0xff_00 && firstWord <= 0xff_ff)
  );
}

export function isBlockedPublicHttpHostname(hostname: string): boolean {
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

function getResolvedAddressFailure(
  addresses: readonly string[]
): PublicHttpUrlFailure | null {
  if (addresses.length === 0) {
    return "hostname-resolution-failed";
  }

  for (const address of addresses) {
    const normalized = normalizeHostname(address);
    const ipv4 = parseIpv4Address(normalized);
    if (ipv4) {
      if (isBlockedIpv4(ipv4)) {
        return "internal-address";
      }
      continue;
    }

    const ipv6 = parseIpv6Address(normalized);
    if (ipv6) {
      if (isBlockedIpv6(ipv6)) {
        return "internal-address";
      }
      continue;
    }

    return "hostname-resolution-failed";
  }

  return null;
}

function isDnsJsonResponse(value: unknown): value is DnsJsonResponse {
  return typeof value === "object" && value !== null;
}

async function queryDnsJsonAddresses(
  hostname: string,
  recordType: DnsJsonRecordType,
  signal?: AbortSignal
): Promise<readonly string[] | null> {
  const endpoint = new URL(PUBLIC_DNS_JSON_ENDPOINT);
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", recordType);

  let response: Response;
  try {
    response = await globalThis.fetch(endpoint.toString(), {
      headers: { accept: "application/dns-json" },
      signal,
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (!isDnsJsonResponse(payload)) {
    return null;
  }

  if (
    payload.Status !== DNS_SUCCESS_STATUS &&
    payload.Status !== DNS_NAME_NOT_FOUND_STATUS
  ) {
    return null;
  }

  const answers = Array.isArray(payload.Answer) ? payload.Answer : [];

  return answers
    .filter(
      (answer) =>
        answer.type === DNS_RECORD_TYPES[recordType] &&
        typeof answer.data === "string"
    )
    .map((answer) => answer.data as string);
}

export async function resolvePublicHostnameWithDoh(
  hostname: string,
  { signal }: PublicHostnameResolutionOptions = {}
): Promise<readonly string[]> {
  const normalized = normalizeHostname(hostname);
  const [ipv4Addresses, ipv6Addresses] = await Promise.all([
    queryDnsJsonAddresses(normalized, "A", signal),
    queryDnsJsonAddresses(normalized, "AAAA", signal),
  ]);

  if (!(ipv4Addresses && ipv6Addresses)) {
    throw new Error("Failed to resolve public hostname");
  }

  return [...ipv4Addresses, ...ipv6Addresses];
}

export function validatePublicHttpUrl(url: string): PublicHttpUrlResult {
  const parsed = parseUrl(url);
  if (!parsed) {
    return { ok: false, reason: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid-protocol" };
  }

  if (isBlockedPublicHttpHostname(parsed.hostname)) {
    return { ok: false, reason: "internal-address" };
  }

  return { ok: true, parsed, url };
}

export async function validateResolvedPublicHttpUrl(
  url: string,
  {
    resolveHostname = resolvePublicHostnameWithDoh,
    signal,
  }: ValidateResolvedPublicHttpUrlOptions = {}
): Promise<PublicHttpUrlResult> {
  const validation = validatePublicHttpUrl(url);
  if (!validation.ok || resolveHostname === false) {
    return validation;
  }

  if (isIpAddress(validation.parsed.hostname)) {
    return validation;
  }

  let addresses: readonly string[];
  try {
    addresses = await resolveHostname(validation.parsed.hostname, { signal });
  } catch {
    return { ok: false, reason: "hostname-resolution-failed" };
  }

  const failure = getResolvedAddressFailure(addresses);
  if (failure) {
    return { ok: false, reason: failure };
  }

  return validation;
}

export function validatePublicHttpUrlParam(
  urlParam: string | null
): PublicHttpUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  return validatePublicHttpUrl(urlParam);
}

export function isPublicHttpUrl(value: string): boolean {
  const validation = validatePublicHttpUrl(value);
  return validation.ok;
}

export function fetchPublicHttpUrlWithValidatedRedirects({
  fetchImpl,
  init,
  maxRedirects,
  resolveHostname = fetchImpl === globalThis.fetch
    ? resolvePublicHostnameWithDoh
    : false,
  url,
}: FetchPublicHttpUrlOptions): Promise<PublicHttpFetchResult> {
  return fetchWithValidatedRedirectResult({
    fetchImpl,
    init,
    invalidUrlReason: "invalid-url",
    maxRedirects,
    url,
    validateUrl: (candidateUrl) =>
      validateResolvedPublicHttpUrl(candidateUrl, {
        resolveHostname,
        signal: init?.signal ?? undefined,
      }),
  });
}
