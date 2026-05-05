import { AppError, captureError, type ErrorCategory } from "@avoid.quest/error";
import { z } from "zod";
import type { StreamAccessDecision } from "./stream-access";

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

const BLOCKED_HOSTNAMES = [
  "localhost",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
];

const BLOCKED_HOSTNAME_SUFFIXES = [".onion", ".local", ".internal"];

const BLOCKED_HOSTNAME_PREFIXES = [
  "127.",
  "10.",
  "192.168.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "169.254.",
  "fc",
  "fd",
  "fe80:",
  "::ffff:127.",
  "::ffff:10.",
  "::ffff:192.168.",
  "::ffff:172.16.",
  "::ffff:172.17.",
  "::ffff:172.18.",
  "::ffff:172.19.",
  "::ffff:172.20.",
  "::ffff:172.21.",
  "::ffff:172.22.",
  "::ffff:172.23.",
  "::ffff:172.24.",
  "::ffff:172.25.",
  "::ffff:172.26.",
  "::ffff:172.27.",
  "::ffff:172.28.",
  "::ffff:172.29.",
  "::ffff:172.30.",
  "::ffff:172.31.",
  "::ffff:169.254.",
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

function createStreamProxyError(init: {
  category: ErrorCategory;
  code: string;
  expected: boolean;
  safeMessage: string;
  status: number;
  tags?: Record<string, string | number | boolean>;
}): AppError {
  return new AppError(init);
}

function isBlockedStreamHostname(hostname: string): boolean {
  return (
    BLOCKED_HOSTNAMES.includes(hostname) ||
    BLOCKED_HOSTNAME_PREFIXES.some((prefix) => hostname.startsWith(prefix)) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function getPrivateAddressReason(urlParam: string): AppError | null {
  const parsed = new URL(urlParam);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return createStreamProxyError({
      code: "STREAM_PROXY_INVALID_PROTOCOL",
      safeMessage: "Invalid URL: must use http or https protocol",
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!isBlockedStreamHostname(hostname)) {
    return null;
  }

  return createStreamProxyError({
    code: "STREAM_PROXY_INTERNAL_ADDRESS",
    safeMessage: "Internal addresses not allowed",
    category: "security",
    expected: true,
    status: 400,
  });
}

function validateStreamUrl(urlParam: string | null): string | AppError {
  if (!urlParam) {
    return createStreamProxyError({
      code: "STREAM_PROXY_URL_REQUIRED",
      safeMessage: "URL parameter is required",
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  const urlValidation = URL_SCHEMA.safeParse(urlParam);
  if (!urlValidation.success) {
    return createStreamProxyError({
      code: "STREAM_PROXY_INVALID_URL",
      safeMessage: "Invalid URL format",
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  return getPrivateAddressReason(urlParam) ?? urlParam;
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
      const res = await fetchImpl(url, {
        headers: createForwardedStreamHeaders(request),
      });

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
    if (accessDecision.mode === "direct") {
      const streamUrl = accessDecision.resolvedUrl ?? urlValidation;
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
