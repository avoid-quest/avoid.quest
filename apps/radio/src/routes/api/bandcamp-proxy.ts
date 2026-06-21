/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { AppError, type AppErrorInit, captureError } from "@avoid.quest/error";
import { createFileRoute } from "@tanstack/react-router";
import {
  type BandcampCdnUrlValidationFailure,
  validateBandcampCdnUrl,
} from "@/lib/proxy/bandcamp-url-policy";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";
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
type BandcampRedirectFailure =
  ValidatedRedirectFailure<BandcampCdnUrlValidationFailure>;

const BANDCAMP_INVALID_URL_ERROR = {
  code: "BANDCAMP_PROXY_INVALID_URL",
  safeMessage: "Invalid URL format",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const BANDCAMP_INVALID_PROTOCOL_ERROR = {
  code: "BANDCAMP_PROXY_INVALID_PROTOCOL",
  safeMessage: "Invalid URL: must use HTTP or HTTPS",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const BANDCAMP_INVALID_DOMAIN_ERROR = {
  code: "BANDCAMP_PROXY_INVALID_DOMAIN",
  safeMessage: "Invalid URL: must be a Bandcamp CDN URL",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const BANDCAMP_URL_FAILURE_ERRORS = {
  required: {
    code: "BANDCAMP_PROXY_URL_REQUIRED",
    safeMessage: "URL parameter is required",
    category: "validation",
    expected: true,
    status: 400,
  },
  "invalid-url": BANDCAMP_INVALID_URL_ERROR,
  "invalid-protocol": BANDCAMP_INVALID_PROTOCOL_ERROR,
  "invalid-domain": BANDCAMP_INVALID_DOMAIN_ERROR,
} as const satisfies Record<BandcampCdnUrlValidationFailure, AppErrorInit>;

const BANDCAMP_REDIRECT_FAILURE_ERRORS = {
  required: BANDCAMP_INVALID_URL_ERROR,
  "invalid-url": BANDCAMP_INVALID_URL_ERROR,
  "invalid-protocol": BANDCAMP_INVALID_PROTOCOL_ERROR,
  "invalid-domain": BANDCAMP_INVALID_DOMAIN_ERROR,
  "missing-location": {
    code: "BANDCAMP_PROXY_REDIRECT_LOCATION_MISSING",
    safeMessage: "Upstream redirect missing Location header",
    category: "dependency",
    expected: false,
    status: 502,
  },
  "too-many-redirects": {
    code: "BANDCAMP_PROXY_TOO_MANY_REDIRECTS",
    safeMessage: "Too many Bandcamp CDN redirects",
    category: "dependency",
    expected: false,
    status: 502,
  },
} as const satisfies Record<BandcampRedirectFailure, AppErrorInit>;

function createBandcampError(init: AppErrorInit): AppError {
  return new AppError(init);
}

function createBandcampUrlError(
  reason: BandcampCdnUrlValidationFailure
): AppError {
  return createBandcampError(BANDCAMP_URL_FAILURE_ERRORS[reason]);
}

function createBandcampRedirectError(
  reason: BandcampRedirectFailure
): AppError {
  return createBandcampError(BANDCAMP_REDIRECT_FAILURE_ERRORS[reason]);
}

function validateUrl(
  urlParam: string | null,
  origin: string,
  requestId: string
): string | Response {
  const urlValidation = validateBandcampCdnUrl(urlParam);
  if (!urlValidation.ok) {
    return proxyPolicy.problem(
      createBandcampUrlError(urlValidation.reason),
      origin,
      requestId
    );
  }

  return urlValidation.url;
}

export async function fetchBandcampProxyStream(
  url: string,
  request: Request,
  origin: string,
  requestId: string,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const { response: res } = await fetchWithValidatedRedirects({
      fetchImpl,
      init: {
        signal: controller.signal,
        headers: {
          Range: request.headers.get("range") || "",
          Referer: "https://bandcamp.com/",
        },
      },
      invalidUrlReason: "invalid-url",
      maxRedirects: MAX_REDIRECTS,
      url,
      validateUrl: validateBandcampCdnUrl,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return proxyPolicy.problem(
        new AppError({
          code: "BANDCAMP_PROXY_UPSTREAM_ERROR",
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
            code: "BANDCAMP_PROXY_RESPONSE_TOO_LARGE",
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
        createBandcampRedirectError(error.reason as BandcampRedirectFailure),
        origin,
        requestId
      );
    }

    if (error instanceof Error && error.name === "AbortError") {
      return proxyPolicy.problem(
        new AppError({
          code: "BANDCAMP_PROXY_TIMEOUT",
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
      code: "BANDCAMP_PROXY_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    });

    captureError(error instanceof AppError ? error : appError, {
      surface: "api-route",
      operation: "bandcamp-proxy.fetch",
      requestId,
    });

    return proxyPolicy.problem(appError, origin, requestId);
  }
}

export const Route = createFileRoute("/api/bandcamp-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: "bandcamp-proxy",
          operation: "bandcamp-proxy.GET",
          fallback: {
            code: "BANDCAMP_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: async ({ origin, request, requestId }) => {
            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateUrl(urlParam, origin, requestId);
            if (urlValidation instanceof Response) {
              return urlValidation;
            }

            return fetchBandcampProxyStream(
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
