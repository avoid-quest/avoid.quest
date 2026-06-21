/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { AppError, type AppErrorInit, captureError } from "@avoid.quest/error";
import { createFileRoute } from "@tanstack/react-router";
import { logSSRFAttempt } from "@/lib/logger";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";
import {
  type SoundCloudCdnUrlValidationFailure,
  validateSoundCloudCdnUrl,
} from "@/lib/proxy/soundcloud-url-policy";
import {
  fetchWithValidatedRedirects,
  ValidatedRedirectError,
  type ValidatedRedirectFailure,
} from "@/lib/proxy/validated-redirects";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024;

const proxyPolicy = createProxyRequestPolicy();
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SoundCloudRedirectFailure =
  ValidatedRedirectFailure<SoundCloudCdnUrlValidationFailure>;

const SOUNDCLOUD_INVALID_URL_ERROR = {
  code: "SOUNDCLOUD_PROXY_INVALID_URL",
  safeMessage: "Invalid URL format",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const SOUNDCLOUD_INVALID_PROTOCOL_ERROR = {
  code: "SOUNDCLOUD_PROXY_INVALID_PROTOCOL",
  safeMessage: "Invalid URL: must use HTTP or HTTPS",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const SOUNDCLOUD_PAGE_URL_ERROR = {
  code: "SOUNDCLOUD_PROXY_PAGE_URL_NOT_ALLOWED",
  safeMessage: "Invalid URL: must be a stream URL, not a page URL",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const SOUNDCLOUD_INVALID_DOMAIN_ERROR = {
  code: "SOUNDCLOUD_PROXY_INVALID_DOMAIN",
  safeMessage: "Invalid domain: not a SoundCloud CDN domain",
  category: "security",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const SOUNDCLOUD_URL_FAILURE_ERRORS = {
  required: {
    code: "SOUNDCLOUD_PROXY_URL_REQUIRED",
    safeMessage: "URL parameter is required",
    category: "validation",
    expected: true,
    status: 400,
  },
  "invalid-url": SOUNDCLOUD_INVALID_URL_ERROR,
  "invalid-protocol": SOUNDCLOUD_INVALID_PROTOCOL_ERROR,
  "page-url": SOUNDCLOUD_PAGE_URL_ERROR,
  "invalid-domain": SOUNDCLOUD_INVALID_DOMAIN_ERROR,
} as const satisfies Record<SoundCloudCdnUrlValidationFailure, AppErrorInit>;

const SOUNDCLOUD_REDIRECT_FAILURE_ERRORS = {
  required: SOUNDCLOUD_INVALID_URL_ERROR,
  "invalid-url": SOUNDCLOUD_INVALID_URL_ERROR,
  "invalid-protocol": SOUNDCLOUD_INVALID_PROTOCOL_ERROR,
  "page-url": SOUNDCLOUD_PAGE_URL_ERROR,
  "invalid-domain": SOUNDCLOUD_INVALID_DOMAIN_ERROR,
  "missing-location": {
    code: "SOUNDCLOUD_PROXY_REDIRECT_LOCATION_MISSING",
    safeMessage: "Upstream redirect missing Location header",
    category: "dependency",
    expected: false,
    status: 502,
  },
  "too-many-redirects": {
    code: "SOUNDCLOUD_PROXY_TOO_MANY_REDIRECTS",
    safeMessage: "Too many SoundCloud CDN redirects",
    category: "dependency",
    expected: false,
    status: 502,
  },
} as const satisfies Record<SoundCloudRedirectFailure, AppErrorInit>;

function createSoundCloudError(init: AppErrorInit): AppError {
  return new AppError(init);
}

function createSoundCloudUrlError(
  reason: SoundCloudCdnUrlValidationFailure
): AppError {
  return createSoundCloudError(SOUNDCLOUD_URL_FAILURE_ERRORS[reason]);
}

function createSoundCloudRedirectError(
  reason: SoundCloudRedirectFailure
): AppError {
  return createSoundCloudError(SOUNDCLOUD_REDIRECT_FAILURE_ERRORS[reason]);
}

function validateSoundCloudUrl(
  urlParam: string | null,
  origin: string,
  sessionId: string,
  ip: string | undefined,
  requestId: string
): string | Response {
  const urlValidation = validateSoundCloudCdnUrl(urlParam);
  if (urlValidation.ok) {
    return urlValidation.url;
  }

  if (urlValidation.reason === "invalid-domain") {
    logSSRFAttempt(sessionId, urlParam ?? "", "soundcloud-proxy", ip);
  }

  return proxyPolicy.problem(
    createSoundCloudUrlError(urlValidation.reason),
    origin,
    requestId
  );
}

export async function fetchSoundCloudProxyStream(
  url: string,
  request: Request,
  origin: string,
  requestId: string,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const rangeHeader = request.headers.get("range");
    const requestHeaders: HeadersInit = {
      Referer: "https://soundcloud.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (rangeHeader) {
      requestHeaders.Range = rangeHeader;
    }

    const { response: res } = await fetchWithValidatedRedirects({
      fetchImpl,
      init: {
        signal: controller.signal,
        headers: requestHeaders,
      },
      invalidUrlReason: "invalid-url",
      maxRedirects: MAX_REDIRECTS,
      url,
      validateUrl: validateSoundCloudCdnUrl,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return proxyPolicy.problem(
        new AppError({
          code: "SOUNDCLOUD_PROXY_UPSTREAM_ERROR",
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
            code: "SOUNDCLOUD_PROXY_RESPONSE_TOO_LARGE",
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
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
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

    if (error instanceof ValidatedRedirectError) {
      return proxyPolicy.problem(
        createSoundCloudRedirectError(
          error.reason as SoundCloudRedirectFailure
        ),
        origin,
        requestId
      );
    }

    if (error instanceof Error && error.name === "AbortError") {
      return proxyPolicy.problem(
        new AppError({
          code: "SOUNDCLOUD_PROXY_TIMEOUT",
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
      code: "SOUNDCLOUD_PROXY_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    });

    captureError(error instanceof AppError ? error : appError, {
      surface: "api-route",
      operation: "soundcloud-proxy.fetch",
      requestId,
    });

    return proxyPolicy.problem(appError, origin, requestId);
  }
}

export const Route = createFileRoute("/api/soundcloud-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: "soundcloud-proxy",
          operation: "soundcloud-proxy.GET",
          fallback: {
            code: "SOUNDCLOUD_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: async ({ auth, origin, request, requestId }) => {
            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateSoundCloudUrl(
              urlParam,
              origin,
              auth.sessionId,
              auth.ip,
              requestId
            );
            if (urlValidation instanceof Response) {
              return urlValidation;
            }

            return fetchSoundCloudProxyStream(
              urlValidation,
              request,
              origin,
              requestId
            );
          },
        }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
