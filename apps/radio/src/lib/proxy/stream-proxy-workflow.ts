import { AppError, type AppErrorInit, captureError } from "@avoid.quest/error";
import {
  fetchPublicStreamWithRedirects,
  type StreamAccessDecision,
  type StreamRedirectFailure,
  type StreamRedirectFailureDetails,
} from "./stream-access";
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

type StreamAccessInspector = (
  url: string,
  options: {
    origin: string;
    requestHeaders?: Headers;
  }
) => Promise<StreamAccessDecision>;

type StreamProxyPolicy = {
  errorHeaders: (request: Request) => HeadersInit;
  problem: (error: AppError, origin: string, requestId: string) => Response;
};

type StreamProxyWorkflowDependencies = {
  captureError?: typeof captureError;
  fetchImpl?: FetchLike;
  inspectStreamAccess: StreamAccessInspector;
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
} as const satisfies Record<StreamUrlValidationFailure, AppErrorInit>;

const STREAM_REDIRECT_FAILURE_ERRORS = {
  "invalid-url": STREAM_PROXY_INVALID_URL_ERROR,
  "invalid-protocol": STREAM_PROXY_INVALID_PROTOCOL_ERROR,
  "internal-address": STREAM_PROXY_INTERNAL_ADDRESS_ERROR,
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
  proxyPolicy: StreamProxyPolicy
): Response {
  const responseHeaders = new Headers(proxyPolicy.errorHeaders(request));
  responseHeaders.set(
    "Access-Control-Expose-Headers",
    EXPOSED_STREAM_HEADERS.join(", ")
  );
  responseHeaders.set("x-request-id", requestId);

  for (const header of EXPOSED_STREAM_HEADERS) {
    copyHeaderIfPresent(upstreamResponse.headers, responseHeaders, header);
  }

  const contentRange = upstreamResponse.headers.get("Content-Range");
  if (contentRange) {
    responseHeaders.set("Content-Range", contentRange);
    responseHeaders.set("Accept-Ranges", "bytes");
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function createForwardedStreamHeaders(request: Request): HeadersInit {
  const headers: HeadersInit = {
    "Icy-MetaData": request.headers.get("Icy-MetaData") || "0",
  };

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    headers.Range = rangeHeader;
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
  inspectStreamAccess,
  proxyPolicy,
}: StreamProxyWorkflowDependencies) {
  const fetchStream = async (
    url: string,
    { origin, request, requestId }: StreamProxyWorkflowContext
  ): Promise<Response> => {
    try {
      const fetchResult = await fetchPublicStreamWithRedirects(
        url,
        {
          headers: createForwardedStreamHeaders(request),
        },
        fetchImpl
      );
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

      return buildStreamResponse(res, request, requestId, proxyPolicy);
    } catch (error) {
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

    const accessDecision = await inspectStreamAccess(urlValidation, {
      origin: context.origin,
      requestHeaders: context.request.headers,
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
      return buildStreamResponse(
        accessDecision.response,
        context.request,
        context.requestId,
        proxyPolicy
      );
    }

    return fetchStream(urlValidation, context);
  };

  return { handle };
}
