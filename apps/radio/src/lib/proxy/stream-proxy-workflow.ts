import { AppError, type AppErrorInit, captureError } from "@avoid.quest/error";
import {
  fetchPublicStreamWithRedirects,
  type StreamAccessDecision,
  type StreamRedirectFailure,
  type StreamRedirectFailureDetails,
} from "./stream-access";
import {
  applyBoundedRangeHeader,
  getContentLengthLimitFailure,
  limitResponseBody,
} from "./stream-limits";
import {
  type StreamUrlValidationFailure,
  validatePublicStreamUrl,
} from "./url-policy";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const EXPOSED_STREAM_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Icy-MetaInt",
  "Icy-Name",
  "Icy-Description",
  "Icy-Genre",
  "Icy-Br",
];
const STREAM_PROXY_FETCH_TIMEOUT_MS = 10_000;
const STREAM_PROXY_MAX_RANGE_BYTES = 8 * 1024 * 1024;
const STREAM_PROXY_MAX_STREAM_DURATION_MS = 2 * 60 * 60 * 1000;
const STREAM_PROXY_MAX_AVERAGE_BITRATE_BPS = 1_000_000;
const STREAM_PROXY_MAX_STREAMED_BYTES = bytesForBitrateDuration(
  STREAM_PROXY_MAX_AVERAGE_BITRATE_BPS,
  STREAM_PROXY_MAX_STREAM_DURATION_MS
);
const STREAM_PROXY_FETCH_TIMEOUT_REASON = "stream-proxy-fetch-timeout";

type StreamAccessInspector = (
  url: string,
  options: {
    origin: string;
    preparedHeaders?: Headers;
  }
) => Promise<StreamAccessDecision>;

type StreamProxyPolicy = {
  errorHeaders: (request: Request) => HeadersInit;
  problem: (error: AppError, origin: string, requestId: string) => Response;
};

type StreamProxyWorkflowDependencies = {
  captureError?: typeof captureError;
  fetchTimeoutMs?: number;
  fetchImpl?: FetchLike;
  inspectStreamAccess: StreamAccessInspector;
  maxRangeBytes?: number;
  maxStreamDurationMs?: number;
  maxStreamedBytes?: number;
  proxyPolicy: StreamProxyPolicy;
};

type StreamProxyWorkflowContext = {
  origin: string;
  request: Request;
  requestId: string;
};

function createStreamProxyError(init: AppErrorInit): AppError {
  return new AppError(init);
}

function bytesForBitrateDuration(
  bitsPerSecond: number,
  durationMs: number
): number {
  return Math.ceil((bitsPerSecond * durationMs) / 8000);
}

const STREAM_PROXY_INVALID_URL_ERROR = {
  code: "STREAM_PROXY_INVALID_URL",
  safeMessage: "Invalid URL format",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STREAM_PROXY_INVALID_PROTOCOL_ERROR = {
  code: "STREAM_PROXY_INVALID_PROTOCOL",
  safeMessage: "Invalid URL: must use http or https protocol",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STREAM_PROXY_INTERNAL_ADDRESS_ERROR = {
  code: "STREAM_PROXY_INTERNAL_ADDRESS",
  safeMessage: "Internal addresses not allowed",
  category: "security",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STREAM_PROXY_HOSTNAME_RESOLUTION_ERROR = {
  code: "STREAM_PROXY_HOSTNAME_RESOLUTION_FAILED",
  safeMessage: "Failed to resolve stream host",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STREAM_PROXY_INVALID_RANGE_ERROR = {
  code: "STREAM_PROXY_INVALID_RANGE",
  safeMessage: "Invalid Range header",
  category: "validation",
  expected: true,
  status: 416,
} as const satisfies AppErrorInit;

const STREAM_PROXY_RESPONSE_TOO_LARGE_ERROR = {
  code: "STREAM_PROXY_RESPONSE_TOO_LARGE",
  safeMessage: "Response too large",
  category: "validation",
  expected: true,
  status: 413,
} as const satisfies AppErrorInit;

const STREAM_PROXY_TIMEOUT_ERROR = {
  code: "STREAM_PROXY_TIMEOUT",
  safeMessage: "Request timeout",
  category: "network",
  expected: true,
  status: 408,
} as const satisfies AppErrorInit;

const STREAM_URL_VALIDATION_ERRORS = {
  required: {
    code: "STREAM_PROXY_URL_REQUIRED",
    safeMessage: "URL parameter is required",
    category: "validation",
    expected: true,
    status: 400,
  },
  "invalid-url": STREAM_PROXY_INVALID_URL_ERROR,
  "invalid-protocol": STREAM_PROXY_INVALID_PROTOCOL_ERROR,
  "internal-address": STREAM_PROXY_INTERNAL_ADDRESS_ERROR,
  "hostname-resolution-failed": STREAM_PROXY_HOSTNAME_RESOLUTION_ERROR,
} as const satisfies Record<StreamUrlValidationFailure, AppErrorInit>;

const STREAM_REDIRECT_FAILURE_ERRORS = {
  "invalid-url": STREAM_PROXY_INVALID_URL_ERROR,
  "invalid-protocol": STREAM_PROXY_INVALID_PROTOCOL_ERROR,
  "internal-address": STREAM_PROXY_INTERNAL_ADDRESS_ERROR,
  "hostname-resolution-failed": STREAM_PROXY_HOSTNAME_RESOLUTION_ERROR,
  "missing-location": {
    code: "STREAM_PROXY_REDIRECT_LOCATION_MISSING",
    safeMessage: "Upstream redirect missing Location header",
    category: "dependency",
    expected: false,
    status: 502,
  },
  "too-many-redirects": {
    code: "STREAM_PROXY_TOO_MANY_REDIRECTS",
    safeMessage: "Too many stream redirects",
    category: "dependency",
    expected: false,
    status: 502,
  },
} as const satisfies Record<StreamRedirectFailure, AppErrorInit>;

function validateStreamUrl(urlParam: string | null): string | AppError {
  const validation = validatePublicStreamUrl(urlParam);
  if (validation.ok) {
    return validation.url;
  }

  return createStreamProxyError(
    STREAM_URL_VALIDATION_ERRORS[validation.reason]
  );
}

function createRedirectFailureError(
  failure: StreamRedirectFailureDetails
): AppError {
  return createStreamProxyError(STREAM_REDIRECT_FAILURE_ERRORS[failure.reason]);
}

function createResponseTooLargeError(): AppError {
  return createStreamProxyError(STREAM_PROXY_RESPONSE_TOO_LARGE_ERROR);
}

function copyHeaderIfPresent(
  source: Headers,
  target: Headers,
  headerName: string
): void {
  const value = source.get(headerName);
  if (value) {
    target.set(headerName, value);
  }
}

function buildStreamResponse(
  upstreamResponse: Response,
  request: Request,
  requestId: string,
  proxyPolicy: StreamProxyPolicy,
  maxStreamedBytes: number,
  maxStreamDurationMs: number,
  abortController?: AbortController
): Response {
  const responseHeaders = new Headers(proxyPolicy.errorHeaders(request));
  responseHeaders.set(
    "Access-Control-Expose-Headers",
    EXPOSED_STREAM_HEADERS.join(", ")
  );
  responseHeaders.set("x-request-id", requestId);

  for (const header of EXPOSED_STREAM_HEADERS) {
    if (header === "Content-Length") {
      continue;
    }
    copyHeaderIfPresent(upstreamResponse.headers, responseHeaders, header);
  }

  const contentRange = upstreamResponse.headers.get("Content-Range");
  if (contentRange) {
    responseHeaders.set("Content-Range", contentRange);
    responseHeaders.set("Accept-Ranges", "bytes");
  }

  const body = limitResponseBody(upstreamResponse.body, {
    abortController,
    maxBytes: maxStreamedBytes,
    maxDurationMs: maxStreamDurationMs,
  });

  return new Response(body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function validateUpstreamResponseSize(
  response: Response,
  maxStreamedBytes: number
): AppError | null {
  const failure = getContentLengthLimitFailure(
    response.headers,
    maxStreamedBytes
  );
  return failure ? createResponseTooLargeError() : null;
}

function createForwardedStreamHeaders(
  request: Request,
  maxRangeBytes: number
): Headers | AppError {
  const headers = new Headers({
    "Icy-MetaData": request.headers.get("Icy-MetaData") || "0",
  });

  const rangeResult = applyBoundedRangeHeader(headers, request, maxRangeBytes);
  if (!rangeResult.ok) {
    return createStreamProxyError(STREAM_PROXY_INVALID_RANGE_ERROR);
  }

  return headers;
}

function redirectToStream(
  url: string,
  request: Request,
  requestId: string,
  proxyPolicy: StreamProxyPolicy
): Response {
  const headers = new Headers(proxyPolicy.errorHeaders(request));
  headers.set("Cache-Control", "private, no-store");
  headers.set("Location", url);
  headers.set("x-request-id", requestId);

  return new Response(null, {
    status: 307,
    headers,
  });
}

function canRedirectDirectStream(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.origin === origin;
  } catch {
    return false;
  }
}

export function createStreamProxyRequestWorkflow({
  captureError: captureErrorImpl = captureError,
  fetchImpl = fetch,
  fetchTimeoutMs = STREAM_PROXY_FETCH_TIMEOUT_MS,
  inspectStreamAccess,
  maxRangeBytes = STREAM_PROXY_MAX_RANGE_BYTES,
  maxStreamDurationMs = STREAM_PROXY_MAX_STREAM_DURATION_MS,
  maxStreamedBytes = STREAM_PROXY_MAX_STREAMED_BYTES,
  proxyPolicy,
}: StreamProxyWorkflowDependencies) {
  const fetchStream = async (
    url: string,
    { origin, request, requestId }: StreamProxyWorkflowContext,
    headers: Headers
  ): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(STREAM_PROXY_FETCH_TIMEOUT_REASON);
    }, fetchTimeoutMs);

    try {
      const fetchResult = await fetchPublicStreamWithRedirects(
        url,
        {
          headers,
          signal: controller.signal,
        },
        fetchImpl
      );
      clearTimeout(timeout);

      if (!fetchResult.ok) {
        return proxyPolicy.problem(
          createRedirectFailureError(fetchResult.failure),
          origin,
          requestId
        );
      }

      const { response: res } = fetchResult;

      if (!res.ok) {
        return proxyPolicy.problem(
          createStreamProxyError({
            code: "STREAM_PROXY_UPSTREAM_ERROR",
            safeMessage: `Upstream error: ${res.status} ${res.statusText}`,
            category: "dependency",
            expected: false,
            status: res.status,
            tags: { upstreamStatus: res.status },
          }),
          origin,
          requestId
        );
      }

      const sizeError = validateUpstreamResponseSize(res, maxStreamedBytes);
      if (sizeError) {
        await res.body?.cancel();
        return proxyPolicy.problem(sizeError, origin, requestId);
      }

      return buildStreamResponse(
        res,
        request,
        requestId,
        proxyPolicy,
        maxStreamedBytes,
        maxStreamDurationMs,
        controller
      );
    } catch (error) {
      clearTimeout(timeout);

      if (controller.signal.reason === STREAM_PROXY_FETCH_TIMEOUT_REASON) {
        return proxyPolicy.problem(
          createStreamProxyError(STREAM_PROXY_TIMEOUT_ERROR),
          origin,
          requestId
        );
      }

      const appError = createStreamProxyError({
        code: "STREAM_PROXY_FETCH_FAILED",
        safeMessage: "Failed to fetch stream",
        category: "network",
        expected: false,
        status: 502,
      });

      captureErrorImpl(error instanceof AppError ? error : appError, {
        surface: "api-route",
        operation: "stream-proxy.fetchStream",
        requestId,
        tags: { endpoint: "stream-proxy" },
      });

      return proxyPolicy.problem(appError, origin, requestId);
    }
  };

  const handle = async (
    context: StreamProxyWorkflowContext
  ): Promise<Response> => {
    const urlParam = new URL(context.request.url).searchParams.get("url");
    const urlValidation = validateStreamUrl(urlParam);
    if (urlValidation instanceof AppError) {
      return proxyPolicy.problem(
        urlValidation,
        context.origin,
        context.requestId
      );
    }

    const headers = createForwardedStreamHeaders(
      context.request,
      maxRangeBytes
    );
    if (headers instanceof AppError) {
      return proxyPolicy.problem(headers, context.origin, context.requestId);
    }

    const accessDecision = await inspectStreamAccess(urlValidation, {
      origin: context.origin,
      preparedHeaders: headers,
    });

    if (accessDecision.mode === "rejected") {
      return proxyPolicy.problem(
        createRedirectFailureError(accessDecision.failure),
        context.origin,
        context.requestId
      );
    }

    if (accessDecision.mode === "direct" && accessDecision.resolvedUrl) {
      const streamUrl = accessDecision.resolvedUrl;
      if (canRedirectDirectStream(streamUrl, context.origin)) {
        return redirectToStream(
          streamUrl,
          context.request,
          context.requestId,
          proxyPolicy
        );
      }
    }

    if (accessDecision.response?.ok) {
      const sizeError = validateUpstreamResponseSize(
        accessDecision.response,
        maxStreamedBytes
      );
      if (sizeError) {
        await accessDecision.response.body?.cancel();
        return proxyPolicy.problem(
          sizeError,
          context.origin,
          context.requestId
        );
      }

      return buildStreamResponse(
        accessDecision.response,
        context.request,
        context.requestId,
        proxyPolicy,
        maxStreamedBytes,
        maxStreamDurationMs
      );
    }

    return fetchStream(urlValidation, context, headers);
  };

  return { handle };
}
