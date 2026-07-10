import {
  ResolverAdapterError,
  ResolverAggregateError,
  type ResolverAttemptDiagnostic,
  type ResolverErrorCode,
} from "./errors.js";
import { sanitizeResolverId } from "./identity.js";
import {
  assertResolverResolveRequest,
  assertResolverSearchRequest,
} from "./request.js";
import type {
  ResolverAdapter,
  ResolverBroker,
  ResolverProvider,
  ResolverResolution,
  ResolverResolveRequest,
  ResolverSearchRequest,
  ResolverSearchResultMap,
} from "./types.js";

function stableErrorMessage(code: ResolverErrorCode): string {
  switch (code) {
    case "aborted":
      return "Resolver request was aborted";
    case "invalid-input":
      return "Resolver request is invalid";
    default:
      return "Resolver adapter failed";
  }
}

function normalizeError(
  adapter: ResolverAdapter,
  error: unknown
): ResolverAdapterError {
  const adapterId = sanitizeResolverId(adapter.id);
  if (error instanceof ResolverAdapterError) {
    return new ResolverAdapterError(stableErrorMessage(error.code), {
      adapterId,
      code: error.code,
      retryable: error.retryable,
      status: error.status,
    });
  }
  return new ResolverAdapterError("Resolver adapter failed", {
    adapterId,
    code: "network-or-cors",
  });
}

function diagnostic(error: ResolverAdapterError): ResolverAttemptDiagnostic {
  return {
    adapterId: error.adapterId,
    code: error.code,
    ...(error.status === undefined ? {} : { status: error.status }),
  };
}

async function runWithFailover<T>(
  adapters: readonly ResolverAdapter[],
  operation: "resolve" | "search",
  provider: ResolverProvider,
  run: (adapter: ResolverAdapter) => Promise<T>
): Promise<T> {
  const attempts: ResolverAttemptDiagnostic[] = [];
  for (const adapter of adapters) {
    try {
      return await run(adapter);
    } catch (error) {
      const normalized = normalizeError(adapter, error);
      if (!normalized.retryable) {
        throw normalized;
      }
      attempts.push(diagnostic(normalized));
    }
  }
  throw new ResolverAggregateError(operation, provider, attempts);
}

export function createResolverBroker(
  adapters: readonly ResolverAdapter[]
): ResolverBroker {
  const configuredAdapters = [...adapters];
  return {
    adapters: configuredAdapters,
    search: async <P extends ResolverProvider>(
      request: ResolverSearchRequest<P>
    ): Promise<ResolverSearchResultMap[P]> => {
      assertResolverSearchRequest(request, "resolver:broker");
      return await runWithFailover(
        configuredAdapters,
        "search",
        request.provider,
        async (adapter) => await adapter.search(request)
      );
    },
    resolve: async <P extends ResolverProvider>(
      request: ResolverResolveRequest<P>
    ): Promise<ResolverResolution<P>> => {
      assertResolverResolveRequest(request, "resolver:broker");
      return await runWithFailover(
        configuredAdapters,
        "resolve",
        request.provider,
        async (adapter) => ({
          ...(await adapter.resolve(request)),
          resolverId: sanitizeResolverId(adapter.id),
        })
      );
    },
  };
}
