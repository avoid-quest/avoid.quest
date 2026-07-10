import {
  isLoopbackHostname,
  isLoopbackHttpUrl,
  isPublicHttpUrl,
} from "../url-policy/index.js";
import type { YouTubeItemResult, YouTubeSearchResult } from "./types.js";

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const LEADING_SLASH_PATTERN = /^\//;
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

export type YouTubeProviderKind = "invidious" | "piped";

export type YouTubeProviderErrorCode =
  | "aborted"
  | "http"
  | "invalid-configuration"
  | "invalid-input"
  | "invalid-json"
  | "invalid-schema"
  | "media-cors"
  | "network-or-cors"
  | "no-audio"
  | "response-too-large"
  | "timeout"
  | "unexpected-content-type"
  | "unsupported-live-stream";

type YouTubeProviderErrorOptions = {
  cause?: unknown;
  code: YouTubeProviderErrorCode;
  kind: YouTubeProviderKind;
  providerId: string;
  retryable?: boolean;
  status?: number;
};

export class YouTubeProviderError extends Error {
  readonly code: YouTubeProviderErrorCode;
  readonly kind: YouTubeProviderKind;
  readonly providerId: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: YouTubeProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "YouTubeProviderError";
    this.code = options.code;
    this.kind = options.kind;
    this.providerId = options.providerId;
    this.retryable = options.retryable ?? true;
    this.status = options.status;
  }
}

export class YouTubeProviderAggregateError extends Error {
  readonly errors: readonly YouTubeProviderError[];

  constructor(errors: readonly YouTubeProviderError[]) {
    super("Every configured YouTube provider failed", {
      cause: errors.at(-1),
    });
    this.name = "YouTubeProviderAggregateError";
    this.errors = errors;
  }
}

export type YouTubeProviderProbe = {
  kind: YouTubeProviderKind;
  providerId: string;
  status: "ready";
};

export type YouTubeProviderSearchFilter = "songs" | "videos";

export type YouTubeProviderAdapter = {
  readonly id: string;
  readonly kind: YouTubeProviderKind;
  probe(signal?: AbortSignal): Promise<YouTubeProviderProbe>;
  resolveItem(url: string, signal?: AbortSignal): Promise<YouTubeItemResult>;
  resolveStream(videoId: string, signal?: AbortSignal): Promise<string>;
  search(
    query: string,
    filter?: YouTubeProviderSearchFilter,
    signal?: AbortSignal
  ): Promise<YouTubeSearchResult[]>;
};

export type YouTubeProviderAdapterOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  id?: string;
  maxResponseBytes?: number;
  timeoutMs?: number;
  verifyMedia?: boolean;
};

export type YouTubeProviderRequestContext = {
  baseUrl: string;
  fetchImpl: typeof fetch;
  kind: YouTubeProviderKind;
  maxResponseBytes: number;
  providerId: string;
  timeoutMs: number;
  verifyMedia: boolean;
};

type RequestSignal = {
  cleanup: () => void;
  didTimeOut: () => boolean;
  signal: AbortSignal;
};

function configurationError(
  kind: YouTubeProviderKind,
  message: string,
  cause?: unknown
): YouTubeProviderError {
  return new YouTubeProviderError(message, {
    cause,
    code: "invalid-configuration",
    kind,
    providerId: `${kind}:configuration`,
    retryable: false,
  });
}

function normalizeBaseUrl(value: string, kind: YouTubeProviderKind): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw configurationError(kind, "YouTube provider URL is invalid", error);
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHostname(url.hostname))
  ) {
    throw configurationError(
      kind,
      "YouTube provider URL must use HTTPS (or localhost HTTP)"
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configurationError(
      kind,
      "YouTube provider URL must not contain credentials, a query, or a fragment"
    );
  }

  url.pathname = url.pathname.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  return url.toString().replace(TRAILING_SLASH_PATTERN, "");
}

export function createYouTubeProviderRequestContext(
  kind: YouTubeProviderKind,
  options: YouTubeProviderAdapterOptions
): YouTubeProviderRequestContext {
  const baseUrl = normalizeBaseUrl(options.baseUrl, kind);
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw configurationError(kind, "YouTube provider timeout is invalid");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw configurationError(
      kind,
      "YouTube provider response size limit is invalid"
    );
  }

  return {
    baseUrl,
    fetchImpl: options.fetchImpl ?? fetch,
    kind,
    maxResponseBytes,
    providerId: options.id?.trim() || `${kind}:${new URL(baseUrl).host}`,
    timeoutMs,
    verifyMedia: options.verifyMedia ?? true,
  };
}

export function providerUrl(
  context: YouTubeProviderRequestContext,
  path: string
): URL {
  return new URL(
    path.replace(LEADING_SLASH_PATTERN, ""),
    `${context.baseUrl}/`
  );
}

export function resolveProviderUrl(
  context: YouTubeProviderRequestContext,
  value: string
): string {
  let url: URL;
  try {
    url = new URL(value, `${context.baseUrl}/`);
  } catch (error) {
    throw invalidProviderSchema(
      context,
      error instanceof Error
        ? `YouTube provider returned an invalid media URL: ${error.message}`
        : "YouTube provider returned an invalid media URL"
    );
  }
  const providerIsLoopback = isLoopbackHostname(
    new URL(context.baseUrl).hostname
  );
  const isAllowedPublicUrl =
    url.protocol === "https:" && isPublicHttpUrl(url.toString());
  const isAllowedLoopbackUrl =
    providerIsLoopback && isLoopbackHttpUrl(url.toString());
  if (
    url.username ||
    url.password ||
    !(isAllowedPublicUrl || isAllowedLoopbackUrl)
  ) {
    throw invalidProviderSchema(
      context,
      "YouTube provider returned an unsafe media URL"
    );
  }
  return url.toString();
}

function responseTooLarge(
  context: YouTubeProviderRequestContext
): YouTubeProviderError {
  return new YouTubeProviderError("YouTube provider response is too large", {
    code: "response-too-large",
    kind: context.kind,
    providerId: context.providerId,
  });
}

async function readBoundedText(
  context: YouTubeProviderRequestContext,
  response: Response
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  const contentLength = declaredLength === null ? null : Number(declaredLength);
  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    contentLength > context.maxResponseBytes
  ) {
    await response.body?.cancel();
    throw responseTooLarge(context);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > context.maxResponseBytes) {
      throw responseTooLarge(context);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > context.maxResponseBytes) {
      await reader.cancel();
      throw responseTooLarge(context);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function createRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): RequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abortFromParent, { once: true });
  if (parent?.aborted) {
    abortFromParent();
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("Provider request timed out", "TimeoutError")
    );
  }, timeoutMs);

  return {
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
    didTimeOut: () => timedOut,
    signal: controller.signal,
  };
}

function requestError(
  context: YouTubeProviderRequestContext,
  requestSignal: RequestSignal,
  parent: AbortSignal | undefined,
  error: unknown,
  media: boolean
): YouTubeProviderError {
  if (requestSignal.didTimeOut()) {
    return new YouTubeProviderError("YouTube provider request timed out", {
      cause: error,
      code: "timeout",
      kind: context.kind,
      providerId: context.providerId,
    });
  }
  if (parent?.aborted) {
    return new YouTubeProviderError("YouTube provider request was aborted", {
      cause: error,
      code: "aborted",
      kind: context.kind,
      providerId: context.providerId,
      retryable: false,
    });
  }
  return new YouTubeProviderError(
    media
      ? "YouTube media proxy is unavailable or blocked by CORS"
      : "YouTube provider is unavailable or blocked by CORS",
    {
      cause: error,
      code: media ? "media-cors" : "network-or-cors",
      kind: context.kind,
      providerId: context.providerId,
    }
  );
}

async function withProviderResponse<T>(
  context: YouTubeProviderRequestContext,
  url: URL | string,
  signal: AbortSignal | undefined,
  init: RequestInit,
  media: boolean,
  read: (response: Response) => Promise<T>
): Promise<T> {
  const requestSignal = createRequestSignal(signal, context.timeoutMs);
  try {
    const { fetchImpl } = context;
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      ...init,
      redirect: "error",
      signal: requestSignal.signal,
    });
    return await read(response);
  } catch (error) {
    if (error instanceof YouTubeProviderError) {
      throw error;
    }
    throw requestError(context, requestSignal, signal, error, media);
  } finally {
    requestSignal.cleanup();
  }
}

function assertSuccessfulResponse(
  context: YouTubeProviderRequestContext,
  response: Response
): void {
  if (!response.ok) {
    throw new YouTubeProviderError(
      `YouTube provider returned HTTP ${response.status}`,
      {
        code: "http",
        kind: context.kind,
        providerId: context.providerId,
        status: response.status,
      }
    );
  }
}

export async function fetchProviderJson(
  context: YouTubeProviderRequestContext,
  url: URL,
  signal?: AbortSignal
): Promise<unknown> {
  return await withProviderResponse(
    context,
    url,
    signal,
    { headers: { Accept: "application/json" } },
    false,
    async (response) => {
      assertSuccessfulResponse(context, response);

      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("json")) {
        throw new YouTubeProviderError(
          `YouTube provider returned unexpected content type: ${contentType || "missing"}`,
          {
            code: "unexpected-content-type",
            kind: context.kind,
            providerId: context.providerId,
          }
        );
      }

      const body = await readBoundedText(context, response);
      try {
        return JSON.parse(body) as unknown;
      } catch (error) {
        throw new YouTubeProviderError(
          "YouTube provider returned invalid JSON",
          {
            cause: error,
            code: "invalid-json",
            kind: context.kind,
            providerId: context.providerId,
          }
        );
      }
    }
  );
}

export async function fetchProviderText(
  context: YouTubeProviderRequestContext,
  url: URL,
  signal?: AbortSignal
): Promise<string> {
  return await withProviderResponse(
    context,
    url,
    signal,
    { headers: { Accept: "text/plain" } },
    false,
    async (response) => {
      assertSuccessfulResponse(context, response);
      return await readBoundedText(context, response);
    }
  );
}

export function invalidProviderSchema(
  context: YouTubeProviderRequestContext,
  message = "YouTube provider response has an unexpected schema"
): YouTubeProviderError {
  return new YouTubeProviderError(message, {
    code: "invalid-schema",
    kind: context.kind,
    providerId: context.providerId,
  });
}

export function invalidProviderInput(
  context: YouTubeProviderRequestContext,
  message: string
): YouTubeProviderError {
  return new YouTubeProviderError(message, {
    code: "invalid-input",
    kind: context.kind,
    providerId: context.providerId,
    retryable: false,
  });
}

export function providerOperationError(
  context: YouTubeProviderRequestContext,
  code: "no-audio" | "unsupported-live-stream",
  message: string
): YouTubeProviderError {
  return new YouTubeProviderError(message, {
    code,
    kind: context.kind,
    providerId: context.providerId,
    retryable: code !== "unsupported-live-stream",
  });
}

export async function verifyProviderMedia(
  context: YouTubeProviderRequestContext,
  url: string,
  signal?: AbortSignal
): Promise<void> {
  if (!context.verifyMedia) {
    return;
  }

  await withProviderResponse(
    context,
    url,
    signal,
    {
      headers: {
        Accept: "audio/*, application/octet-stream;q=0.8, */*;q=0.1",
        Range: "bytes=0-0",
      },
    },
    true,
    async (response) => {
      assertSuccessfulResponse(context, response);

      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("text/html") || contentType.includes("json")) {
        throw new YouTubeProviderError(
          "YouTube media proxy returned a non-audio response",
          {
            code: "unexpected-content-type",
            kind: context.kind,
            providerId: context.providerId,
          }
        );
      }

      await response.body?.cancel();
    }
  );
}
