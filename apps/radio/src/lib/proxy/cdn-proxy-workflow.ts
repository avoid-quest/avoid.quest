import { AppError, type AppErrorInit, captureError } from "@avoid.quest/error";
import {
  type FetchLike,
  fetchWithValidatedRedirectResult,
  type UrlValidationResult,
  type ValidatedRedirectFailure,
} from "@avoid.quest/platforms/redirects";
import {
  applyBoundedRangeHeader,
  getContentLengthLimitFailure,
  limitResponseBody,
} from "./stream-limits";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_SIZE = 100 * 1024 * 1024;
const DEFAULT_MAX_RANGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STREAM_DURATION_MS = 10 * 60 * 1000;

export type CdnProxyPolicy = {
  errorHeaders: (request: Request) => HeadersInit;
  problem: (error: AppError, origin: string, requestId: string) => Response;
};

export type CdnProxyFetchContext = {
  origin: string;
  request: Request;
  requestId: string;
};

export type CdnProxyWorkflowContext<AuthContext = unknown> =
  CdnProxyFetchContext & {
    auth: AuthContext;
  };

type UrlValidator<UrlFailure extends string> = (
  urlParam: string | null
) => UrlValidationResult<UrlFailure>;

type RedirectUrlValidator<RedirectFailure extends string> = (
  url: string
) => UrlValidationResult<RedirectFailure>;

type CdnProxyWorkflowConfig<
  UrlFailure extends string,
  RedirectFailure extends string,
  AuthContext = unknown,
> = {
  captureError?: typeof captureError | undefined;
  createUpstreamHeaders: (request: Request) => HeadersInit;
  fetchFailedError: AppErrorInit;
  fetchImpl?: FetchLike | undefined;
  fetchTimeoutMs?: number | undefined;
  invalidRangeError: AppErrorInit;
  invalidUrlReason: RedirectFailure;
  maxRedirects?: number | undefined;
  maxRangeBytes?: number | undefined;
  maxResponseSize?: number | undefined;
  maxStreamDurationMs?: number | undefined;
  onUrlValidationFailure?:
    | ((details: {
        context: CdnProxyWorkflowContext<AuthContext>;
        reason: UrlFailure;
        urlParam: string | null;
      }) => void)
    | undefined;
  operation: string;
  proxyPolicy: CdnProxyPolicy;
  redirectFailureErrors: Readonly<
    Record<ValidatedRedirectFailure<RedirectFailure>, AppErrorInit>
  >;
  responseTooLargeError: AppErrorInit;
  timeoutError: AppErrorInit;
  upstreamError: (response: Response) => AppErrorInit;
  urlFailureErrors: Readonly<Record<UrlFailure, AppErrorInit>>;
  validateRedirectUrl: RedirectUrlValidator<RedirectFailure>;
  validateUrl: UrlValidator<UrlFailure>;
};

export type CdnProxyWorkflow<AuthContext> = {
  fetchStream: (
    url: string,
    context: CdnProxyFetchContext,
    fetchImpl?: FetchLike
  ) => Promise<Response>;
  handle: (context: CdnProxyWorkflowContext<AuthContext>) => Promise<Response>;
};

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

function buildCdnStreamResponse(
  upstreamResponse: Response,
  { request, requestId }: CdnProxyFetchContext,
  proxyPolicy: CdnProxyPolicy,
  {
    abortController,
    maxResponseSize,
    maxStreamDurationMs,
  }: {
    abortController: AbortController;
    maxResponseSize: number;
    maxStreamDurationMs: number;
  }
): Response {
  const headers = new Headers(proxyPolicy.errorHeaders(request));
  headers.set(
    "Content-Type",
    upstreamResponse.headers.get("Content-Type") || "audio/mpeg"
  );
  headers.set("Accept-Ranges", "bytes");
  headers.set("x-request-id", requestId);

  copyHeaderIfPresent(upstreamResponse.headers, headers, "Content-Length");
  copyHeaderIfPresent(upstreamResponse.headers, headers, "Content-Range");

  const body = limitResponseBody(upstreamResponse.body, {
    abortController,
    maxBytes: maxResponseSize,
    maxDurationMs: maxStreamDurationMs,
  });

  return new Response(body, {
    status: upstreamResponse.status,
    headers,
  });
}

export function createCdnProxyRequestWorkflow<
  UrlFailure extends string,
  RedirectFailure extends string,
  AuthContext = unknown,
>({
  captureError: captureErrorImpl = captureError,
  createUpstreamHeaders,
  fetchFailedError,
  fetchImpl: defaultFetchImpl = fetch,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  invalidRangeError,
  invalidUrlReason,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  maxRangeBytes = DEFAULT_MAX_RANGE_BYTES,
  maxResponseSize = DEFAULT_MAX_RESPONSE_SIZE,
  maxStreamDurationMs = DEFAULT_MAX_STREAM_DURATION_MS,
  onUrlValidationFailure,
  operation,
  proxyPolicy,
  redirectFailureErrors,
  responseTooLargeError,
  timeoutError,
  upstreamError,
  validateRedirectUrl,
  urlFailureErrors,
  validateUrl,
}: CdnProxyWorkflowConfig<
  UrlFailure,
  RedirectFailure,
  AuthContext
>): CdnProxyWorkflow<AuthContext> {
  const fetchStream = async (
    url: string,
    context: CdnProxyFetchContext,
    fetchImpl: FetchLike = defaultFetchImpl
  ): Promise<Response> => {
    const upstreamHeaders = new Headers(createUpstreamHeaders(context.request));
    const rangeResult = applyBoundedRangeHeader(
      upstreamHeaders,
      context.request,
      maxRangeBytes
    );
    if (!rangeResult.ok) {
      return proxyPolicy.problem(
        new AppError(invalidRangeError),
        context.origin,
        context.requestId
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const redirectResult = await fetchWithValidatedRedirectResult({
        fetchImpl,
        init: {
          signal: controller.signal,
          headers: upstreamHeaders,
        },
        invalidUrlReason,
        maxRedirects,
        url,
        validateUrl: validateRedirectUrl,
      });

      clearTimeout(timeout);

      if (!redirectResult.ok) {
        return proxyPolicy.problem(
          new AppError(redirectFailureErrors[redirectResult.failure.reason]),
          context.origin,
          context.requestId
        );
      }

      const { response } = redirectResult;

      if (!response.ok) {
        return proxyPolicy.problem(
          new AppError(upstreamError(response)),
          context.origin,
          context.requestId
        );
      }

      if (getContentLengthLimitFailure(response.headers, maxResponseSize)) {
        await response.body?.cancel();
        return proxyPolicy.problem(
          new AppError(responseTooLargeError),
          context.origin,
          context.requestId
        );
      }

      return buildCdnStreamResponse(response, context, proxyPolicy, {
        abortController: controller,
        maxResponseSize,
        maxStreamDurationMs,
      });
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === "AbortError") {
        return proxyPolicy.problem(
          new AppError(timeoutError),
          context.origin,
          context.requestId
        );
      }

      const appError = new AppError(fetchFailedError);

      captureErrorImpl(error instanceof AppError ? error : appError, {
        surface: "api-route",
        operation,
        requestId: context.requestId,
      });

      return proxyPolicy.problem(appError, context.origin, context.requestId);
    }
  };

  const handle = (
    context: CdnProxyWorkflowContext<AuthContext>
  ): Promise<Response> => {
    const urlParam = new URL(context.request.url).searchParams.get("url");
    const urlValidation = validateUrl(urlParam);
    if (!urlValidation.ok) {
      onUrlValidationFailure?.({
        context,
        reason: urlValidation.reason,
        urlParam,
      });

      return Promise.resolve(
        proxyPolicy.problem(
          new AppError(urlFailureErrors[urlValidation.reason]),
          context.origin,
          context.requestId
        )
      );
    }

    return fetchStream(urlValidation.url, context);
  };

  return {
    fetchStream,
    handle,
  };
}
