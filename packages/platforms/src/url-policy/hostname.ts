const TRAILING_DOTS_PATTERN = /\.+$/;
const BRACKETED_HOSTNAME_PATTERN = /^\[(.*)\]$/;
const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;
const LOOPBACK_IPV4_MAPPED_IPV6_PATTERN = /^::ffff:127(?:\.\d{1,3}){3}$/;
const LOOPBACK_IPV4_MAPPED_CANONICAL_IPV6_PATTERN =
  /^::ffff:7f[\da-f]{2}:[\da-f]{1,4}$/;

export function normalizePlatformHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(BRACKETED_HOSTNAME_PATTERN, "$1")
    .replace(TRAILING_DOTS_PATTERN, "");
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizePlatformHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    LOOPBACK_IPV4_PATTERN.test(normalized) ||
    LOOPBACK_IPV4_MAPPED_IPV6_PATTERN.test(normalized) ||
    LOOPBACK_IPV4_MAPPED_CANONICAL_IPV6_PATTERN.test(normalized)
  );
}

export function isLoopbackHttpUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  return parsed !== null && isLoopbackHostname(parsed.hostname);
}

export function isHostnameOrSubdomain(
  hostname: string,
  rootHostname: string
): boolean {
  const normalized = normalizePlatformHostname(hostname);
  return normalized === rootHostname || normalized.endsWith(`.${rootHostname}`);
}

export function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
