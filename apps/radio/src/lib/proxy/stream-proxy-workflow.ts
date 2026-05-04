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
  const isPrivate =
    hostname === "localhost" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.20.") ||
    hostname.startsWith("172.21.") ||
    hostname.startsWith("172.22.") ||
    hostname.startsWith("172.23.") ||
    hostname.startsWith("172.24.") ||
    hostname.startsWith("172.25.") ||
    hostname.startsWith("172.26.") ||
    hostname.startsWith("172.27.") ||
    hostname.startsWith("172.28.") ||
    hostname.startsWith("172.29.") ||
    hostname.startsWith("172.30.") ||
    hostname.startsWith("172.31.") ||
    hostname.startsWith("169.254.") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    hostname.endsWith(".onion") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    hostname.startsWith("::ffff:127.") ||
    hostname.startsWith("::ffff:10.") ||
    hostname.startsWith("::ffff:192.168.") ||
    hostname.startsWith("::ffff:172.16.") ||
    hostname.startsWith("::ffff:172.17.") ||
    hostname.startsWith("::ffff:172.18.") ||
    hostname.startsWith("::ffff:172.19.") ||
    hostname.startsWith("::ffff:172.20.") ||
    hostname.startsWith("::ffff:172.21.") ||
    hostname.startsWith("::ffff:172.22.") ||
    hostname.startsWith("::ffff:172.23.") ||
    hostname.startsWith("::ffff:172.24.") ||
    hostname.startsWith("::ffff:172.25.") ||
    hostname.startsWith("::ffff:172.26.") ||
    hostname.startsWith("::ffff:172.27.") ||
    hostname.startsWith("::ffff:172.28.") ||
    hostname.startsWith("::ffff:172.29.") ||
    hostname.startsWith("::ffff:172.30.") ||
    hostname.startsWith("::ffff:172.31.") ||
    hostname.startsWith("::ffff:169.254.");

  if (!isPrivate) {
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

function buildStreamResponse(
  upstreamResponse: Response,
  request: Request,
  requestId: string,
  proxyPolicy: StreamProxyPolicy
): Response {
  const responseHeaders = new Headers(proxyPolicy.errorHeaders(request));
  responseHeaders.set(
    "Access-Control-Expose-Headers",
    "Content-Type, Content-Length, Icy-MetaInt, Icy-Name, Icy-Description, Icy-Genre, Icy-Br"
  );
  responseHeaders.set("x-request-id", requestId);

  const contentType = upstreamResponse.headers.get("Content-Type");
  if (contentType) {
    responseHeaders.set("Content-Type", contentType);
  }

  const contentLength = upstreamResponse.headers.get("Content-Length");
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }

  for (const header of [
    "Icy-MetaInt",
    "Icy-Name",
    "Icy-Description",
    "Icy-Genre",
    "Icy-Br",
  ]) {
    const value = upstreamResponse.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
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
