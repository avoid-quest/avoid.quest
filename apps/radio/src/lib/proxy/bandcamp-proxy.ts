export type BandcampUrlValidationResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "required"
        | "invalid-url"
        | "invalid-protocol"
        | "invalid-domain";
    };

export function validateBandcampCdnUrl(
  urlParam: string | null
): BandcampUrlValidationResult {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  if (urlParam.length > 2048) {
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

  if (
    parsed.hostname !== "bcbits.com" &&
    !parsed.hostname.endsWith(".bcbits.com")
  ) {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, url: urlParam };
}

export async function cancelUpstreamBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export function createBandcampProxyRequestHeaders(
  request: Request
): HeadersInit {
  const headers: HeadersInit = {
    Referer: "https://bandcamp.com/",
  };
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    headers.Range = rangeHeader;
  }
  return headers;
}
