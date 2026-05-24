import { AppError, captureError } from "@avoid.quest/error";
import { z } from "zod";
import type { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const URL_SCHEMA = z
  .string()
  .max(2048)
  .refine((val) => {
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, "Invalid URL format");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024;

type ProxyPolicy = ReturnType<typeof createProxyRequestPolicy>;

type CdnProxyProviderConfig = {
  endpoint: string;
  referer: string;
  requestHeaders?: HeadersInit;
  errorCodePrefix: string;
  invalidDomainSafeMessage: string;
  allowedHost: (hostname: string) => boolean;
  isPageUrl?: (hostname: string) => boolean;
  pageUrlSafeMessage?: string;
  defaultContentType?: string;
};

type ValidateCdnProxyUrlInput = {
  urlParam: string | null;
  config: CdnProxyProviderConfig;
  logRejectedUrl?: (url: string) => void;
};

type ValidateCdnProxyUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: AppError };

export const BANDCAMP_CDN_PROXY_CONFIG = {
  endpoint: "bandcamp-proxy",
  referer: "https://bandcamp.com/",
  errorCodePrefix: "BANDCAMP_PROXY",
  invalidDomainSafeMessage: "Invalid URL: must be a Bandcamp CDN URL",
  allowedHost: (hostname: string) =>
    hostname === "bcbits.com" || hostname.endsWith(".bcbits.com"),
} satisfies CdnProxyProviderConfig;

const ALLOWED_SOUNDCLOUD_DOMAINS = new Set([
  "cf-media.sndcdn.com",
  "cf-hls-media.sndcdn.com",
  "media.soundcloud.com",
  "ec-media.sndcdn.com",
]);

export const SOUNDCLOUD_CDN_PROXY_CONFIG = {
  endpoint: "soundcloud-proxy",
  referer: "https://soundcloud.com/",
  requestHeaders: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  },
  errorCodePrefix: "SOUNDCLOUD_PROXY",
  invalidDomainSafeMessage: "Invalid domain: not a SoundCloud CDN domain",
  allowedHost: (hostname: string) => ALLOWED_SOUNDCLOUD_DOMAINS.has(hostname),
  isPageUrl: (hostname: string) =>
    hostname === "soundcloud.com" || hostname === "www.soundcloud.com",
  pageUrlSafeMessage: "Invalid URL: must be a stream URL, not a page URL",
} satisfies CdnProxyProviderConfig;

export function validateCdnProxyUrl({
  urlParam,
  config,
  logRejectedUrl,
}: ValidateCdnProxyUrlInput): ValidateCdnProxyUrlResult {
  if (!urlParam) {
    return {
      ok: false,
      error: new AppError({
        code: `${config.errorCodePrefix}_URL_REQUIRED`,
        safeMessage: "URL parameter is required",
        category: "validation",
        expected: true,
        status: 400,
      }),
    };
  }

  const urlValidation = URL_SCHEMA.safeParse(urlParam);
  if (!urlValidation.success) {
    return {
      ok: false,
      error: new AppError({
        code: `${config.errorCodePrefix}_INVALID_URL`,
        safeMessage: "Invalid URL format",
        category: "validation",
        expected: true,
        status: 400,
      }),
    };
  }

  const url = new URL(urlParam);
  const hostname = url.hostname.toLowerCase();

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: new AppError({
        code: `${config.errorCodePrefix}_INVALID_PROTOCOL`,
        safeMessage: "Invalid URL protocol",
        category: "validation",
        expected: true,
        status: 400,
      }),
    };
  }

  if (config.isPageUrl?.(hostname)) {
    return {
      ok: false,
      error: new AppError({
        code: `${config.errorCodePrefix}_PAGE_URL_NOT_ALLOWED`,
        safeMessage:
          config.pageUrlSafeMessage ?? "Invalid URL: must be a CDN URL",
        category: "validation",
        expected: true,
        status: 400,
      }),
    };
  }

  if (!config.allowedHost(hostname)) {
    logRejectedUrl?.(urlParam);
    return {
      ok: false,
      error: new AppError({
        code: `${config.errorCodePrefix}_INVALID_DOMAIN`,
        safeMessage: config.invalidDomainSafeMessage,
        category: "security",
        expected: true,
        status: 400,
      }),
    };
  }

  return { ok: true, url: url.toString() };
}

export async function proxyCdnUrl({
  config,
  origin,
  proxyPolicy,
  request,
  requestId,
  url,
}: {
  config: CdnProxyProviderConfig;
  origin: string;
  proxyPolicy: ProxyPolicy;
  request: Request;
  requestId: string;
  url: string;
}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const rangeHeader = request.headers.get("range");
    const requestHeaders = new Headers(config.requestHeaders);
    requestHeaders.set("Referer", config.referer);
    if (rangeHeader) {
      requestHeaders.set("Range", rangeHeader);
    }

    const res = await fetch(url, {
      signal: controller.signal,
      headers: requestHeaders,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return proxyPolicy.problem(
        new AppError({
          code: `${config.errorCodePrefix}_UPSTREAM_ERROR`,
          safeMessage: `Failed to fetch stream: ${res.statusText}`,
          category: "dependency",
          expected: false,
          status: res.status,
        }),
        origin,
        requestId
      );
    }

    const contentLength = res.headers.get("Content-Length");
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);
      if (size > MAX_RESPONSE_SIZE) {
        return proxyPolicy.problem(
          new AppError({
            code: `${config.errorCodePrefix}_RESPONSE_TOO_LARGE`,
            safeMessage: "Response too large",
            category: "validation",
            expected: true,
            status: 413,
          }),
          origin,
          requestId
        );
      }
    }

    const headers: HeadersInit = {
      ...proxyPolicy.errorHeaders(request),
      "Content-Type":
        res.headers.get("Content-Type") ??
        config.defaultContentType ??
        "audio/mpeg",
      "Accept-Ranges": "bytes",
      "x-request-id": requestId,
    };
    const length = res.headers.get("Content-Length");
    const range = res.headers.get("Content-Range");
    if (length) {
      headers["Content-Length"] = length;
    }
    if (range) {
      headers["Content-Range"] = range;
    }

    return new Response(res.body, { status: res.status, headers });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      return proxyPolicy.problem(
        new AppError({
          code: `${config.errorCodePrefix}_TIMEOUT`,
          safeMessage: "Request timeout",
          category: "network",
          expected: true,
          status: 408,
        }),
        origin,
        requestId
      );
    }

    const appError = new AppError({
      code: `${config.errorCodePrefix}_FETCH_FAILED`,
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    });

    captureError(error instanceof AppError ? error : appError, {
      surface: "api-route",
      operation: `${config.endpoint}.fetch`,
      requestId,
    });

    return proxyPolicy.problem(appError, origin, requestId);
  }
}
