// biome-ignore lint/performance/noNamespaceImport: namespace import required by Sentry SDK
import * as Sentry from "@sentry/tanstackstart-react";

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
  validation: "warning",
  auth: "warning",
  rate_limit: "warning",
  network: "error",
  dependency: "error",
  security: "critical",
  infrastructure: "critical",
  playback: "error",
  unknown: "error",
};

const DEFAULT_STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  validation: 400,
  auth: 401,
  rate_limit: 429,
  network: 502,
  dependency: 502,
  security: 403,
  infrastructure: 500,
  playback: 500,
  unknown: 500,
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
  return { ok: true, data };
}

export function fail(error: AppError, requestId: string): AppResult<never> {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.safeMessage,
      requestId,
      status: error.status,
    },
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

function makeBaseSentryOptions(config: {
  dsn: string;
  environment: string;
  release: string;
}) {
  currentApp = parseAppName(config.release);

  return {
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    sampleRate: 1.0,
    maxBreadcrumbs: 0,
  } as const;
}

function shouldDropKnownBrowserApiNoise(
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

export function initClientSentry(config: {
  dsn: string;
  environment: string;
  release: string;
  tunnel?: string;
}): void {
  if (!config.dsn) {
    return;
  }

  Sentry.init({
    ...makeBaseSentryOptions(config),
    tunnel: config.tunnel,
    beforeSend(event) {
      if (shouldDropKnownBrowserApiNoise(event)) {
        return null;
      }
      return event;
    },
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        networkCaptureBodies: false,
        networkRequestHeaders: [],
        networkResponseHeaders: [],
        networkDetailAllowUrls: [],
      }),
    ],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

export function initServerSentry(config: {
  dsn: string;
  environment: string;
  release: string;
}): void {
  if (!config.dsn) {
    return;
  }

  Sentry.init({
    ...makeBaseSentryOptions(config),
  });
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
    code: "UNEXPECTED_ERROR",
    safeMessage: DEFAULT_SAFE_MESSAGE,
    category: "unknown",
    severity: "error",
    expected: false,
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
      code: appError.code,
      category: appError.category,
      severity: appError.severity,
      expected: appError.expected,
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
    status: payload.status,
    headers,
  });
}

export function withRequestIdHeader(
  response: Response,
  requestId: string
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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
      code: "API_ROUTE_ERROR",
      safeMessage: DEFAULT_SAFE_MESSAGE,
      category: "infrastructure" as const,
      severity: "critical" as const,
      expected: false,
      status: 500,
    };
    const appError = toAppError(error, fallback);

    captureError(appError, {
      operation: options.operation,
      surface: "api-route",
      requestId,
    });

    const headers =
      typeof options.errorHeaders === "function"
        ? options.errorHeaders({ request: options.request, requestId })
        : options.errorHeaders;

    return problemResponse(appError, { requestId, headers });
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
      surface: "server-fn",
      requestId,
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

type PlaybackMode = "single" | "multiple" | "dj";
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
  tags?: Record<string, string | number | boolean>;
  context?: Record<string, unknown>;
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
    streamHost,
    errorMessage: safeMessage,
  });

  const appError = new AppError({
    code: payload.errorCode,
    safeMessage,
    category: "playback",
    severity: "error",
    expected: false,
    status: 500,
    cause: error,
    tags: {
      mode: payload.mode,
      stream_host: streamHost,
      retry_phase: payload.retryPhase ?? "none",
      feature: "radio-playback",
      ...payload.tags,
    },
    context: {
      radioName: payload.radioName,
      radioId: payload.radioId,
      streamHost,
      ...payload.context,
    },
  });

  return captureError(appError, {
    surface: "ui",
    operation: "playback",
    tags: {
      mode: payload.mode,
      stream_host: streamHost,
      retry_phase: payload.retryPhase ?? "none",
      feature: "radio-playback",
      ...payload.tags,
    },
    fingerprint: [
      "radio-playback",
      payload.mode,
      payload.errorCode,
      streamHost,
    ],
    dedupeKey,
    dedupeTtlMs: 30_000,
  });
}
