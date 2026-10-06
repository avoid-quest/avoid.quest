// biome-ignore lint/performance/noNamespaceImport: namespace import required by Sentry SDK
import * as Sentry from "@sentry/core";

export type ErrorCategory =
  | "cancellation"
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
  reportingHandled?: boolean;
};

export type ProblemErrorPayload = {
  code: string;
  message: string;
  requestId: string;
  status: number;
  category?: ErrorCategory;
  expected?: boolean;
  severity?: ErrorSeverity;
  reportingHandled?: boolean;
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
  cancellation: "info",
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
  cancellation: 499,
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
  readonly reportingHandled: boolean;

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
        init.category === "rate_limit" ||
        init.category === "cancellation");
    this.status = init.status ?? DEFAULT_STATUS_BY_CATEGORY[init.category];
    this.tags = init.tags;
    this.context = init.context;
    this.reportingHandled = init.reportingHandled ?? false;
  }
}

export function ok<T>(data: T): AppResult<T> {
  return { data, ok: true };
}

export function fail(
  error: AppError,
  requestId: string,
  reportingHandled = error.reportingHandled
): Extract<AppResult<never>, { ok: false }> {
  return {
    error: {
      category: error.category,
      code: error.code,
      expected: error.expected,
      message: error.safeMessage,
      reportingHandled,
      requestId,
      severity: error.severity,
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

  // The caller owns cancellation intent. An AbortError can also be a
  // terminal playback or network failure, so retain its classification.
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

/** Restore classification and only retain explicitly established reporting ownership. */
export function fromProblemError(payload: ProblemErrorPayload): AppError {
  const category =
    payload.category ?? (payload.status >= 500 ? "dependency" : "validation");
  return new AppError({
    category,
    code: payload.code,
    expected: payload.expected,
    reportingHandled: payload.reportingHandled ?? false,
    safeMessage: payload.message,
    severity: payload.severity,
    status: payload.status,
    tags: { request_id: payload.requestId },
  });
}

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
    beforeSend: filterSentryEvent,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    dataCollection: DATA_COLLECTION,
    dsn: config.dsn,
    environment: config.environment,
    maxBreadcrumbs: 50,
    release: config.release,
    sampleRate: 1.0,
    tracesSampleRate: 0,
  } as const satisfies Sentry.Options;
}

export function shouldDropKnownBrowserApiNoise(
  event: Sentry.ErrorEvent | Sentry.Event
): boolean {
  const values = event.exception?.values;
  if (!values || values.length === 0) {
    return false;
  }

  // A linked exception must not silence an unrelated primary failure.
  return (
    values.length === 1 &&
    values[0]?.value === "Error invoking post: Method not found" &&
    values[0]?.mechanism?.type === "auto.browser.browserapierrors.setTimeout"
  );
}

export function filterSentryEvent(
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint
): Sentry.ErrorEvent | null {
  const error =
    hint.data?.appError instanceof AppError
      ? hint.data.appError
      : hint.originalException;
  if (
    isAbortPlaybackError(error) ||
    (error instanceof AppError &&
      (error.reportingHandled || !shouldReportToSentry(error)))
  ) {
    return null;
  }
  // Share links keep a local backup in the fragment. The SDK's query control
  // deliberately leaves fragments intact, so remove this one URL component.
  if (event.request?.url) {
    event.request.url = event.request.url.split("#", 1)[0];
  }
  return shouldDropKnownBrowserApiNoise(event) ? null : event;
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
  }
): string | undefined {
  const appError = resolveCaptureError(error);

  if (
    appError.reportingHandled ||
    !shouldReportToSentry(appError) ||
    !Sentry.isEnabled()
  ) {
    return;
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

    for (const [key, value] of Object.entries({
      ...appError.tags,
      ...meta.tags,
    })) {
      scope.setTag(key, asStringTagValue(value));
    }

    if (meta.fingerprint && meta.fingerprint.length > 0) {
      scope.setFingerprint(["{{ default }}", ...meta.fingerprint]);
    }

    if (appError.context) {
      scope.setContext("application", appError.context);
    }
    scope.setLevel(
      appError.severity === "critical" ? "fatal" : appError.severity
    );
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

    // Keep native same-cause dedupe and LinkedErrors' original exception.
    // The hint carries the authoritative wrapper policy only to beforeSend.
    eventId =
      appError.cause instanceof Error
        ? Sentry.captureException(appError.cause, { data: { appError } })
        : Sentry.captureException(appError);
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
    const eventId = captureError(appError, {
      operation: options.operation,
      requestId,
      surface: "server-fn",
    });
    return fail(appError, requestId, appError.reportingHandled || !!eventId);
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

/** Recognize raw SDK aborts; handled errors retain their caller's policy. */
export function isAbortPlaybackError(
  error: unknown,
  _message?: string
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function capturePlaybackError(
  error: unknown,
  payload: PlaybackTelemetryPayload
): string | undefined {
  const streamHost = payload.streamHost ?? hostFromUrl(payload.streamUrl);
  const appError = toAppError(error, {
    category: "playback",
    code: payload.errorCode,
    expected: false,
    safeMessage: normalizeSafeMessage(payload.errorMessage),
  });
  return captureError(appError, {
    fingerprint: ["radio-playback", payload.mode, appError.code],
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
