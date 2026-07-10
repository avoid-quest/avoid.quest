import { isLoopbackHostname } from "../url-policy/index.js";
import { ResolverAdapterError } from "./errors.js";
import {
  assertResolverResolveRequest,
  assertResolverSearchRequest,
} from "./request.js";
import type {
  ResolverAdapter,
  ResolverCapability,
  ResolverManifest,
  ResolverProvider,
  ResolverResolution,
  ResolverResolveRequest,
  ResolverSearchRequest,
  ResolverSearchResultMap,
} from "./types.js";
import {
  parseResolverManifest,
  parseResolverResolution,
  parseResolverSearchResults,
} from "./validation.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LEADING_SLASH_PATTERN = /^\//;
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

export type HttpResolverAdapterOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  id?: string;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

type HttpResolverContext = {
  adapterId: string;
  allowLoopbackUrls: boolean;
  baseUrl: string;
  fetchImpl: typeof fetch;
  maxResponseBytes: number;
  timeoutMs: number;
};

type RequestSignal = {
  cleanup: () => void;
  didTimeOut: () => boolean;
  signal: AbortSignal;
};

function configurationError(message: string): ResolverAdapterError {
  return new ResolverAdapterError(message, {
    adapterId: "resolver:configuration",
    code: "invalid-configuration",
    retryable: false,
  });
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError("Resolver URL is invalid");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHostname(url.hostname))
  ) {
    throw configurationError("Resolver URL must use HTTPS (or localhost HTTP)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configurationError(
      "Resolver URL must not contain credentials, a query, or a fragment"
    );
  }
  url.pathname = url.pathname.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  return url.toString().replace(TRAILING_SLASH_PATTERN, "");
}

function createContext(
  options: HttpResolverAdapterOptions
): HttpResolverContext {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw configurationError("Resolver timeout is invalid");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw configurationError("Resolver response size limit is invalid");
  }
  return {
    adapterId: options.id?.trim() || `resolver:${new URL(baseUrl).host}`,
    allowLoopbackUrls: isLoopbackHostname(new URL(baseUrl).hostname),
    baseUrl,
    fetchImpl: options.fetchImpl ?? fetch,
    maxResponseBytes,
    timeoutMs,
  };
}

function endpoint(context: HttpResolverContext, path: string): URL {
  return new URL(
    path.replace(LEADING_SLASH_PATTERN, ""),
    `${context.baseUrl}/`
  );
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
      new DOMException("Resolver request timed out", "TimeoutError")
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

function classifyRequestError(
  context: HttpResolverContext,
  requestSignal: RequestSignal,
  parent: AbortSignal | undefined
): ResolverAdapterError {
  if (requestSignal.didTimeOut()) {
    return new ResolverAdapterError("Resolver request timed out", {
      adapterId: context.adapterId,
      code: "timeout",
    });
  }
  if (parent?.aborted) {
    return new ResolverAdapterError("Resolver request was aborted", {
      adapterId: context.adapterId,
      code: "aborted",
      retryable: false,
    });
  }
  return new ResolverAdapterError(
    "Resolver is unavailable or blocked by CORS",
    { adapterId: context.adapterId, code: "network-or-cors" }
  );
}

function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return (
    contentType === "application/json" ||
    Boolean(contentType?.endsWith("+json"))
  );
}

function responseTooLarge(context: HttpResolverContext): ResolverAdapterError {
  return new ResolverAdapterError("Resolver response is too large", {
    adapterId: context.adapterId,
    code: "response-too-large",
  });
}

async function readBoundedText(
  context: HttpResolverContext,
  response: Response
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
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

async function requestJson(
  context: HttpResolverContext,
  path: string,
  signal: AbortSignal | undefined,
  body?: UnknownRecord
): Promise<unknown> {
  const requestSignal = createRequestSignal(signal, context.timeoutMs);
  try {
    const fetchRequest = context.fetchImpl;
    const response = await fetchRequest(endpoint(context, path), {
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method: body ? "POST" : "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: requestSignal.signal,
    });
    if (!response.ok) {
      throw new ResolverAdapterError(
        `Resolver returned HTTP ${response.status}`,
        {
          adapterId: context.adapterId,
          code: "http",
          status: response.status,
        }
      );
    }
    if (!hasJsonContentType(response)) {
      throw new ResolverAdapterError(
        "Resolver returned an unexpected content type",
        {
          adapterId: context.adapterId,
          code: "unexpected-content-type",
        }
      );
    }
    const text = await readBoundedText(context, response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ResolverAdapterError("Resolver returned invalid JSON", {
        adapterId: context.adapterId,
        code: "invalid-json",
      });
    }
  } catch (error) {
    if (error instanceof ResolverAdapterError) {
      throw error;
    }
    throw classifyRequestError(context, requestSignal, signal);
  } finally {
    requestSignal.cleanup();
  }
}

type UnknownRecord = Record<string, unknown>;

function capability(
  provider: ResolverProvider,
  operation: "resolve" | "search"
): ResolverCapability {
  return `${provider}:${operation}`;
}

function requireCapability(
  manifest: ResolverManifest,
  required: ResolverCapability,
  adapterId: string
): void {
  if (!manifest.capabilities.includes(required)) {
    throw new ResolverAdapterError(
      "Resolver does not support the requested capability",
      { adapterId, code: "unsupported-capability" }
    );
  }
}

function parseEnvelope(
  value: unknown,
  key: string,
  adapterId: string
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ResolverAdapterError(
      "Resolver response has an unexpected schema",
      { adapterId, code: "invalid-schema" }
    );
  }
  return (value as UnknownRecord)[key];
}

export function createHttpResolverAdapter(
  options: HttpResolverAdapterOptions
): ResolverAdapter {
  const context = createContext(options);
  let manifest: ResolverManifest | undefined;

  async function probe(signal?: AbortSignal): Promise<ResolverManifest> {
    if (manifest) {
      return manifest;
    }
    const parsed = parseResolverManifest(
      await requestJson(
        context,
        ".well-known/avoid-radio-resolver.json",
        signal
      ),
      context.adapterId
    );
    manifest = parsed;
    return parsed;
  }

  return {
    id: context.adapterId,
    probe,
    search: async <P extends ResolverProvider>(
      request: ResolverSearchRequest<P>
    ): Promise<ResolverSearchResultMap[P]> => {
      assertResolverSearchRequest(request, context.adapterId);
      requireCapability(
        await probe(request.signal),
        capability(request.provider, "search"),
        context.adapterId
      );
      const response = await requestJson(
        context,
        "api/search",
        request.signal,
        {
          provider: request.provider,
          query: request.query,
          ...(request.filter === undefined ? {} : { filter: request.filter }),
        }
      );
      return parseResolverSearchResults(
        request.provider,
        parseEnvelope(response, "results", context.adapterId),
        context.adapterId,
        { allowLoopbackUrls: context.allowLoopbackUrls }
      );
    },
    resolve: async <P extends ResolverProvider>(
      request: ResolverResolveRequest<P>
    ): Promise<ResolverResolution<P>> => {
      assertResolverResolveRequest(request, context.adapterId);
      requireCapability(
        await probe(request.signal),
        capability(request.provider, "resolve"),
        context.adapterId
      );
      return parseResolverResolution(
        request.provider,
        await requestJson(context, "api/resolve", request.signal, {
          provider: request.provider,
          url: request.url,
        }),
        context.adapterId,
        { allowLoopbackUrls: context.allowLoopbackUrls }
      );
    },
  };
}
