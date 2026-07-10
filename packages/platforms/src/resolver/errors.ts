import type { ResolverProvider } from "./types.js";

export type ResolverErrorCode =
  | "aborted"
  | "http"
  | "invalid-configuration"
  | "invalid-input"
  | "invalid-json"
  | "invalid-schema"
  | "network-or-cors"
  | "response-too-large"
  | "timeout"
  | "unexpected-content-type"
  | "unsupported-capability";

export type ResolverOperation = "probe" | "resolve" | "search";

export type ResolverAttemptDiagnostic = {
  adapterId: string;
  code: ResolverErrorCode;
  status?: number;
};

type ResolverAdapterErrorOptions = {
  adapterId: string;
  code: ResolverErrorCode;
  retryable?: boolean;
  status?: number;
};

export class ResolverAdapterError extends Error {
  readonly adapterId: string;
  readonly code: ResolverErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: ResolverAdapterErrorOptions) {
    super(message);
    this.name = "ResolverAdapterError";
    this.adapterId = options.adapterId;
    this.code = options.code;
    this.retryable = options.retryable ?? true;
    this.status = options.status;
  }
}

export class ResolverAggregateError extends Error {
  readonly attempts: readonly ResolverAttemptDiagnostic[];
  readonly operation: Exclude<ResolverOperation, "probe">;
  readonly provider: ResolverProvider;

  constructor(
    operation: Exclude<ResolverOperation, "probe">,
    provider: ResolverProvider,
    attempts: readonly ResolverAttemptDiagnostic[]
  ) {
    super(`Every configured resolver failed for ${provider}:${operation}`);
    this.name = "ResolverAggregateError";
    this.operation = operation;
    this.provider = provider;
    this.attempts = attempts;
  }
}
