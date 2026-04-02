export function isAllowedBandcampHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === "bcbits.com" ||
    normalizedHostname.endsWith(".bcbits.com")
  );
}

export function isAllowedBandcampUrl(urlObj: URL): boolean {
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    return false;
  }

  return isAllowedBandcampHostname(urlObj.hostname);
}
