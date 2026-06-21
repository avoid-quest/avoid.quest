import { AppError, type AppErrorInit, captureError } from "@avoid.quest/error";
import {
  type FetchLike,
  fetchWithValidatedRedirectResult,
  type UrlValidationResult,
  type ValidatedRedirectFailure,
} from "@avoid.quest/platforms/redirects";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_SIZE = 100 * 1024 * 1024;

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

type CdnProxyWorkflowConfig<
  UrlFailure extends string,
  AuthContext = unknown,
> = {
  captureError?: typeof captureError | undefined;
  createUpstreamHeaders: (request: Request) => HeadersInit;
  fetchFailedError: AppErrorInit;
  fetchImpl?: FetchLike | undefined;
  fetchTimeoutMs?: number | undefined;
  invalidUrlReason: UrlFailure;
  maxRedirects?: number | undefined;
  maxResponseSize?: number | undefined;
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
    Record<ValidatedRedirectFailure<UrlFailure>, AppErrorInit>
  >;
  responseTooLargeError: AppErrorInit;
  timeoutError: AppErrorInit;
  upstreamError: (response: Response) => AppErrorInit;
  urlFailureErrors: Readonly<Record<UrlFailure, AppErrorInit>>;
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

function isResponseTooLarge(
  response: Response,
  maxResponseSize: number
): boolean {
  const contentLength = response.headers.get("Content-Length");
  if (!contentLength) {
    return false;
  }

  return Number.parseInt(contentLength, 10) > maxResponseSize;
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

function buildCdnStreamResponse(
  upstreamResponse: Response,
  { request, requestId }: CdnProxyFetchContext,
  proxyPolicy: CdnProxyPolicy
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

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}

export function createCdnProxyRequestWorkflow<
  UrlFailure extends string,
  AuthContext = unknown,
>({
  captureError: captureErrorImpl = captureError,
  createUpstreamHeaders,
  fetchFailedError,
  fetchImpl: defaultFetchImpl = fetch,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  invalidUrlReason,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  maxResponseSize = DEFAULT_MAX_RESPONSE_SIZE,
  onUrlValidationFailure,
  operation,
  proxyPolicy,
  redirectFailureErrors,
  responseTooLargeError,
  timeoutError,
  upstreamError,
  urlFailureErrors,
  validateUrl,
}: CdnProxyWorkflowConfig<
  UrlFailure,
  AuthContext
>): CdnProxyWorkflow<AuthContext> {
  const fetchStream = async (
    url: string,
    context: CdnProxyFetchContext,
    fetchImpl: FetchLike = defaultFetchImpl
  ): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const redirectResult = await fetchWithValidatedRedirectResult({
        fetchImpl,
        init: {
          signal: controller.signal,
          headers: createUpstreamHeaders(context.request),
        },
        invalidUrlReason,
        maxRedirects,
        url,
        validateUrl,
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

      if (isResponseTooLarge(response, maxResponseSize)) {
        return proxyPolicy.problem(
          new AppError(responseTooLargeError),
          context.origin,
          context.requestId
        );
      }

      return buildCdnStreamResponse(response, context, proxyPolicy);
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
