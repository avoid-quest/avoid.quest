import type { AppErrorInit } from "@avoid.quest/error";
import type { ValidatedRedirectTargetFailure } from "@avoid.quest/platforms/redirects";
import {
  type SoundCloudCdnUrlValidationFailure,
  validateSoundCloudCdnUrl,
} from "@avoid.quest/platforms/soundcloud/url-policy";
import { logSSRFAttempt } from "@/lib/logger";
import {
  type CdnProxyPolicy,
  createCdnProxyRequestWorkflow,
} from "./cdn-proxy-workflow";

type SoundCloudRedirectFailure =
  ValidatedRedirectTargetFailure<SoundCloudCdnUrlValidationFailure>;
type SoundCloudProxyAuth = {
  ip: string | undefined;
  sessionId: string;
};

type SoundCloudCdnProxyWorkflowDependencies = {
  proxyPolicy: CdnProxyPolicy;
};

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

function createSoundCloudUpstreamHeaders(request: Request): HeadersInit {
  const rangeHeader = request.headers.get("range");
  const requestHeaders: HeadersInit = {
    Referer: "https://soundcloud.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  if (rangeHeader) {
    requestHeaders.Range = rangeHeader;
  }

  return requestHeaders;
}

export function createSoundCloudCdnProxyWorkflow({
  proxyPolicy,
}: SoundCloudCdnProxyWorkflowDependencies) {
  return createCdnProxyRequestWorkflow<
    SoundCloudCdnUrlValidationFailure,
    SoundCloudProxyAuth
  >({
    createUpstreamHeaders: createSoundCloudUpstreamHeaders,
    fetchFailedError: {
      code: "SOUNDCLOUD_PROXY_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    },
    invalidUrlReason: "invalid-url",
    onUrlValidationFailure: ({ context, reason, urlParam }) => {
      if (reason === "invalid-domain") {
        logSSRFAttempt(
          context.auth.sessionId,
          urlParam ?? "",
          "soundcloud-proxy",
          context.auth.ip
        );
      }
    },
    operation: "soundcloud-proxy.fetch",
    proxyPolicy,
    redirectFailureErrors: SOUNDCLOUD_REDIRECT_FAILURE_ERRORS,
    responseTooLargeError: {
      code: "SOUNDCLOUD_PROXY_RESPONSE_TOO_LARGE",
      safeMessage: "Response too large",
      category: "validation",
      expected: true,
      status: 413,
    },
    timeoutError: {
      code: "SOUNDCLOUD_PROXY_TIMEOUT",
      safeMessage: "Request timeout",
      category: "network",
      expected: true,
      status: 408,
    },
    upstreamError: (response) => ({
      code: "SOUNDCLOUD_PROXY_UPSTREAM_ERROR",
      safeMessage: `Failed to fetch stream: ${response.statusText}`,
      category: "dependency",
      expected: false,
      status: response.status,
    }),
    urlFailureErrors: SOUNDCLOUD_URL_FAILURE_ERRORS,
    validateUrl: validateSoundCloudCdnUrl,
  });
}
