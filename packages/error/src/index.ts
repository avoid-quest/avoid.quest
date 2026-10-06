// biome-ignore lint/performance/noNamespaceImport: namespace import required by Sentry SDK
import * as Sentry from "@sentry/core";

export type ErrorCategory =
  | "validation"
  | "auth"
  | "rate_limit"
  | "network"
  | "dependency"
  | "security"
  | "infrastructure"
  | "playback"
  | "unknown";

export type ErrorSeverity = "info" | "warning" | "error" | "critical";

export type AppErrorInit = {
  code: string;
  safeMessage: string;
  category: ErrorCategory;
  severity?: ErrorSeverity;
  expected?: boolean;
  status?: number;
  cause?: unknown;
  tags?: Record<string, string | number | boolean>;
  context?: Record<string, unknown>;
};

export type ProblemErrorPayload = {
  code: string;
  message: string;
  requestId: string;
  status: number;
};

export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProblemErrorPayload };

const DEFAULT_SAFE_MESSAGE = "Something went wrong. Please try again.";

function normalizeSafeMessage(message: unknown): string {
  if (typeof message !== "string") {
    return DEFAULT_SAFE_MESSAGE;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return DEFAULT_SAFE_MESSAGE;
  }

  return trimmed;
}

const DEFAULT_SEVERITY_BY_CATEGORY: Record<ErrorCategory, ErrorSeverity> = {
  auth: "warning",
  dependency: "error",
  infrastructure: "critical",
  network: "error",
  playback: "error",
  rate_limit: "warning",
  security: "critical",
  unknown: "error",
  validation: "warning",
};

const DEFAULT_STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  auth: 401,
  dependency: 502,
  infrastructure: 500,
  network: 502,
  playback: 500,
  rate_limit: 429,
  security: 403,
  unknown: 500,
  validation: 400,
};

let currentApp = "unknown";

export class AppError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly expected: boolean;
  readonly status: number;
  readonly tags?: Record<string, string | number | boolean>;
  readonly context?: Record<string, unknown>;

  constructor(init: AppErrorInit) {
    const safeMessage = normalizeSafeMessage(init.safeMessage);
    super(safeMessage, { cause: init.cause });
    this.name = "AppError";
    this.code = init.code;
    this.safeMessage = safeMessage;
    this.category = init.category;
    this.severity =
      init.severity ?? DEFAULT_SEVERITY_BY_CATEGORY[init.category];
    this.expected =
      init.expected ??
      (init.category === "validation" ||
        init.category === "auth" ||
        init.category === "rate_limit");
    this.status = init.status ?? DEFAULT_STATUS_BY_CATEGORY[init.category];
    this.tags = init.tags;
    this.context = init.context;
  }
}

export function ok<T>(data: T): AppResult<T> {
  return { data, ok: true };
}

export function fail(error: AppError, requestId: string): AppResult<never> {
  return {
    error: {
      code: error.code,
      message: error.safeMessage,
      requestId,
      status: error.status,
    },
    ok: false,
  };
}

export function toAppError(
  error: unknown,
  fallback: Omit<AppErrorInit, "cause">
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError({
    ...fallback,
    cause: error,
  });
}

export function shouldReportToSentry(error: AppError): boolean {
  if (error.severity === "critical") {
    return true;
  }
  if (error.category === "security" || error.category === "infrastructure") {
    return true;
  }
  if (error.expected) {
    return false;
  }
  return true;
}

type DedupeStore = {
  hasSeen: (key: string) => boolean;
};

export function createDedupeStore(
  ttlMs = 30_000,
  now = () => Date.now()
): DedupeStore {
  const seen = new Map<string, number>();

  return {
    hasSeen(key) {
      const ts = now();
      for (const [entryKey, expiresAt] of seen) {
        if (expiresAt <= ts) {
          seen.delete(entryKey);
        }
      }

      const expiresAt = seen.get(key);
      if (expiresAt && expiresAt > ts) {
        return true;
      }

      seen.set(key, ts + ttlMs);
      return false;
    },
  };
}

const dedupeStore = createDedupeStore();
const dedupeStoresByTtl = new Map<number, DedupeStore>();

function parseAppName(release: string): string {
  const [name] = release.split("@");
  return name || "unknown";
}

// Sentry v11 replaced `sendDefaultPii` with `dataCollection`, which collects
// everything when unset. These values reproduce v10's `sendDefaultPii: false`,
// as listed in Sentry's v10-to-v11 migration guide.
const PII_HEADER_DENYLIST = {
  deny: ["forwarded", "-ip", "remote-", "via", "-user", "referer", "referrer"],
};
const DATA_COLLECTION = {
  cookies: false,
  databaseQueryData: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
  httpBodies: [],
  httpHeaders: { request: PII_HEADER_DENYLIST, response: PII_HEADER_DENYLIST },
  queues: false,
  urlQueryParams: false,
  userInfo: false,
} satisfies NonNullable<Sentry.Options["dataCollection"]>;

export function makeSentryOptions(config: {
  dsn: string;
  environment: string;
  release: string;
}) {
  currentApp = parseAppName(config.release);

  return {
    // v11 attaches synthetic stack traces to messages by default; v10 did not.
    attachStacktrace: false,
    beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb) {
      return breadcrumb.category === "console" || breadcrumb.type === "http"
        ? null
        : breadcrumb;
    },
    dataCollection: DATA_COLLECTION,
    dsn: config.dsn,
    enableLogs: false,
    enableMetrics: false,
    environment: config.environment,
    maxBreadcrumbs: 50,
    release: config.release,
    sampleRate: 1.0,
    tracesSampleRate: 0,
  } as const;
}

export function shouldDropKnownBrowserApiNoise(
  event: Sentry.ErrorEvent | Sentry.Event
): boolean {
  const values = event.exception?.values;
  if (!values || values.length === 0) {
    return false;
  }

  const hasExpectedMessage = values.some(
    (value) => value.value === "Error invoking post: Method not found"
  );
  if (!hasExpectedMessage) {
    return false;
  }

  return values.some(
    (value) =>
      value.mechanism?.type === "auto.browser.browserapierrors.setTimeout"
  );
}

export function createRequestId(request: Request): string {
  const incoming = request.headers.get("x-request-id")?.trim();
  if (incoming) {
    return incoming;
  }

  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function createRandomRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function asStringTagValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function resolveCaptureError(error: unknown): AppError {
  return toAppError(error, {
    category: "unknown",
    code: "UNEXPECTED_ERROR",
    expected: false,
    safeMessage: DEFAULT_SAFE_MESSAGE,
    severity: "error",
    status: 500,
  });
}

export function captureError(
  error: unknown,
  meta: {
    operation: string;
    surface: "ui" | "server-fn" | "api-route";
    requestId?: string;
    fingerprint?: string[];
    tags?: Record<string, string | number | boolean>;
    dedupeKey?: string;
    dedupeTtlMs?: number;
  }
): string | undefined {
  const appError = resolveCaptureError(error);

  if (!shouldReportToSentry(appError)) {
    return;
  }

  if (meta.dedupeKey) {
    let localDedupe = dedupeStore;
    if (meta.dedupeTtlMs && meta.dedupeTtlMs > 0) {
      const existing = dedupeStoresByTtl.get(meta.dedupeTtlMs);
      if (existing) {
        localDedupe = existing;
      } else {
        const created = createDedupeStore(meta.dedupeTtlMs);
        dedupeStoresByTtl.set(meta.dedupeTtlMs, created);
        localDedupe = created;
      }
    }

    if (localDedupe.hasSeen(meta.dedupeKey)) {
      return;
    }
  }

  let eventId: string | undefined;

  Sentry.withScope((scope) => {
    scope.setTag("app", currentApp);
    scope.setTag("surface", meta.surface);
    scope.setTag("operation", meta.operation);
    scope.setTag("error_code", appError.code);
    scope.setTag("error_category", appError.category);
    scope.setTag("error_severity", appError.severity);
    scope.setTag("error_expected", String(appError.expected));

    if (meta.requestId) {
      scope.setTag("request_id", meta.requestId);
    }

    if (meta.tags) {
      for (const [key, value] of Object.entries(meta.tags)) {
        scope.setTag(key, asStringTagValue(value));
      }
    }

    if (appError.tags) {
      for (const [key, value] of Object.entries(appError.tags)) {
        scope.setTag(key, asStringTagValue(value));
      }
    }

    if (meta.fingerprint && meta.fingerprint.length > 0) {
      scope.setFingerprint(meta.fingerprint);
    }

    scope.setContext("app_error", {
      category: appError.category,
      code: appError.code,
      expected: appError.expected,
      severity: appError.severity,
      status: appError.status,
    });

    if (meta.requestId) {
      scope.setContext("request", { id: meta.requestId });
    }

    eventId = Sentry.captureException(appError);
  });

  return eventId;
}

export function problemJson(
  error: unknown,
  requestId: string
): ProblemErrorPayload {
  const appError = resolveCaptureError(error);

  return {
    code: appError.code,
    message: appError.safeMessage,
    requestId,
    status: appError.status,
  };
}

export function problemResponse(
  error: unknown,
  options: {
    requestId?: string;
    headers?: HeadersInit;
  }
): Response {
  const requestId = options.requestId ?? createRandomRequestId();
  const payload = problemJson(error, requestId);

  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  headers.set("x-request-id", requestId);

  return new Response(JSON.stringify(payload), {
    headers,
    status: payload.status,
  });
}

export function withRequestIdHeader(
  response: Response,
  requestId: string
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function runApiRoute(options: {
  request: Request;
  operation: string;
  run: (ctx: { requestId: string }) => Promise<Response>;
  fallback?: Omit<AppErrorInit, "cause">;
  errorHeaders?:
    | HeadersInit
    | ((ctx: { request: Request; requestId: string }) => HeadersInit);
}): Promise<Response> {
  const requestId = createRequestId(options.request);

  try {
    const response = await options.run({ requestId });
    return withRequestIdHeader(response, requestId);
  } catch (error) {
    const fallback = options.fallback ?? {
      category: "infrastructure" as const,
      code: "API_ROUTE_ERROR",
      expected: false,
      safeMessage: DEFAULT_SAFE_MESSAGE,
      severity: "critical" as const,
      status: 500,
    };
    const appError = toAppError(error, fallback);

    captureError(appError, {
      operation: options.operation,
      requestId,
      surface: "api-route",
    });

    const headers =
      typeof options.errorHeaders === "function"
        ? options.errorHeaders({ request: options.request, requestId })
        : options.errorHeaders;

    return problemResponse(appError, { headers, requestId });
  }
}

export async function runServerFn<T>(options: {
  operation: string;
  requestId?: string;
  fallback: Omit<AppErrorInit, "cause">;
  run: () => Promise<T>;
}): Promise<AppResult<T>> {
  const requestId = options.requestId ?? createRandomRequestId();

  try {
    const data = await options.run();
    return ok(data);
  } catch (error) {
    const appError = toAppError(error, options.fallback);
    captureError(appError, {
      operation: options.operation,
      requestId,
      surface: "server-fn",
    });
    return fail(appError, requestId);
  }
}

export function hostFromUrl(url?: string): string {
  if (!url) {
    return "unknown";
  }

  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

type PlaybackMode = "single" | "node" | "dj";
type RetryPhase = "initial" | "fallback-no-cors" | "fallback-proxy" | "none";

export type PlaybackTelemetryPayload = {
  mode: PlaybackMode;
  radioName?: string;
  radioId?: string | number;
  streamUrl?: string;
  streamHost?: string;
  errorCode: string;
  errorMessage: string;
  retryPhase?: RetryPhase;
};

const ACTIONABLE_PLAYBACK_PREFIXES = [
  "MEDIA_ERROR_",
  "PLAYBACK_",
  "STREAM_",
  "DJ_",
  "SINGLE_",
  "MULTIPLE_",
];
const ABORTED_OPERATION_MESSAGE_FRAGMENT = "operation was aborted";

export function shouldCapturePlaybackError(errorCode: string): boolean {
  return ACTIONABLE_PLAYBACK_PREFIXES.some((prefix) =>
    errorCode.startsWith(prefix)
  );
}

function hasAbortErrorName(error: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return true;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  return (error as { name?: unknown }).name === "AbortError";
}

export function isAbortPlaybackError(error: unknown, message: string): boolean {
  if (hasAbortErrorName(error)) {
    return true;
  }

  return message.toLowerCase().includes(ABORTED_OPERATION_MESSAGE_FRAGMENT);
}

export function buildPlaybackEventKey(
  payload: PlaybackTelemetryPayload
): string {
  const streamHost = payload.streamHost ?? hostFromUrl(payload.streamUrl);
  return [payload.mode, streamHost].join("|");
}

export function capturePlaybackError(
  error: unknown,
  payload: PlaybackTelemetryPayload
): string | undefined {
  if (!shouldCapturePlaybackError(payload.errorCode)) {
    return;
  }

  const safeMessage = normalizeSafeMessage(payload.errorMessage);
  if (isAbortPlaybackError(error, safeMessage)) {
    return;
  }

  const streamHost = payload.streamHost ?? hostFromUrl(payload.streamUrl);
  const dedupeKey = buildPlaybackEventKey({
    ...payload,
    errorMessage: safeMessage,
    streamHost,
  });

  const appError = new AppError({
    category: "playback",
    cause: error,
    code: payload.errorCode,
    context: {
      radioId: payload.radioId,
      radioName: payload.radioName,
      streamHost,
    },
    expected: false,
    safeMessage,
    severity: "error",
    status: 500,
    tags: {
      feature: "radio-playback",
      mode: payload.mode,
      retry_phase: payload.retryPhase ?? "none",
      stream_host: streamHost,
    },
  });

  return captureError(appError, {
    dedupeKey,
    dedupeTtlMs: 30_000,
    fingerprint: [
      "radio-playback",
      payload.mode,
      payload.errorCode,
      streamHost,
    ],
    operation: "playback",
    surface: "ui",
    tags: {
      feature: "radio-playback",
      mode: payload.mode,
      retry_phase: payload.retryPhase ?? "none",
      stream_host: streamHost,
    },
  });
}
