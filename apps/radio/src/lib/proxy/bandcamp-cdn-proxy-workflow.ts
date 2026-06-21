import type { AppErrorInit } from "@avoid.quest/error";
import type { ValidatedRedirectFailure } from "@avoid.quest/platforms/redirects";
import {
  type BandcampCdnUrlValidationFailure,
  validateBandcampCdnUrl,
} from "./bandcamp-url-policy";
import {
  type CdnProxyPolicy,
  createCdnProxyRequestWorkflow,
} from "./cdn-proxy-workflow";

type BandcampRedirectFailure =
  ValidatedRedirectFailure<BandcampCdnUrlValidationFailure>;

type BandcampCdnProxyWorkflowDependencies = {
  proxyPolicy: CdnProxyPolicy;
};

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

function createBandcampUpstreamHeaders(request: Request): HeadersInit {
  return {
    Range: request.headers.get("range") || "",
    Referer: "https://bandcamp.com/",
  };
}

export function createBandcampCdnProxyWorkflow({
  proxyPolicy,
}: BandcampCdnProxyWorkflowDependencies) {
  return createCdnProxyRequestWorkflow({
    createUpstreamHeaders: createBandcampUpstreamHeaders,
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
}
