const TRAILING_DOTS_PATTERN = /\.+$/;

export function normalizePlatformHostname(hostname: string): string {
  return hostname.toLowerCase().replace(TRAILING_DOTS_PATTERN, "");
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
