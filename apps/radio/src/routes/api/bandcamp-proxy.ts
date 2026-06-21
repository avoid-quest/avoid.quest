/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import type { AppErrorInit } from "@avoid.quest/error";
import type {
  FetchLike,
  ValidatedRedirectFailure,
} from "@avoid.quest/platforms/redirects";
import { createFileRoute } from "@tanstack/react-router";
import {
  type BandcampCdnUrlValidationFailure,
  validateBandcampCdnUrl,
} from "@/lib/proxy/bandcamp-url-policy";
import { createCdnProxyRequestWorkflow } from "@/lib/proxy/cdn-proxy-workflow";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const proxyPolicy = createProxyRequestPolicy();
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

const bandcampProxyWorkflow = createCdnProxyRequestWorkflow({
  createUpstreamHeaders: (request) => ({
    Range: request.headers.get("range") || "",
    Referer: "https://bandcamp.com/",
  }),
  fetchFailedError: {
    code: "BANDCAMP_PROXY_FETCH_FAILED",
    safeMessage: "Failed to fetch stream",
    category: "network",
    expected: false,
    status: 500,
  },
  invalidUrlReason: "invalid-url",
  operation: "bandcamp-proxy.fetch",
  proxyPolicy,
  redirectFailureErrors: BANDCAMP_REDIRECT_FAILURE_ERRORS,
  responseTooLargeError: {
    code: "BANDCAMP_PROXY_RESPONSE_TOO_LARGE",
    safeMessage: "Response too large",
    category: "validation",
    expected: true,
    status: 413,
  },
  timeoutError: {
    code: "BANDCAMP_PROXY_TIMEOUT",
    safeMessage: "Request timeout",
    category: "network",
    expected: true,
    status: 408,
  },
  upstreamError: (response) => ({
    code: "BANDCAMP_PROXY_UPSTREAM_ERROR",
    safeMessage: `Failed to fetch stream: ${response.statusText}`,
    category: "dependency",
    expected: false,
    status: response.status,
  }),
  urlFailureErrors: BANDCAMP_URL_FAILURE_ERRORS,
  validateUrl: validateBandcampCdnUrl,
});

export function fetchBandcampProxyStream(
  url: string,
  request: Request,
  origin: string,
  requestId: string,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  return bandcampProxyWorkflow.fetchStream(
    url,
    { origin, request, requestId },
    fetchImpl
  );
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
          run: async (context) => bandcampProxyWorkflow.handle(context),
        }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
