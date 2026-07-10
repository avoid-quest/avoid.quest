import { ResolverAdapterError } from "./errors.js";
import type {
  ResolverProvider,
  ResolverResolveRequest,
  ResolverSearchRequest,
} from "./types.js";

const BANDCAMP_FILTERS = new Set(["", "a", "b", "t"]);

function invalidInput(adapterId: string): ResolverAdapterError {
  return new ResolverAdapterError("Resolver request is invalid", {
    adapterId,
    code: "invalid-input",
    retryable: false,
  });
}

export function assertResolverSearchRequest<P extends ResolverProvider>(
  request: ResolverSearchRequest<P>,
  adapterId: string
): void {
  if (
    typeof request.query !== "string" ||
    request.query.trim().length === 0 ||
    request.query.length > 500 ||
    (request.filter !== undefined &&
      (request.provider !== "bandcamp" ||
        !BANDCAMP_FILTERS.has(request.filter)))
  ) {
    throw invalidInput(adapterId);
  }
}

export function assertResolverResolveRequest<P extends ResolverProvider>(
  request: ResolverResolveRequest<P>,
  adapterId: string
): void {
  if (typeof request.url !== "string" || request.url.length > 4096) {
    throw invalidInput(adapterId);
  }
  try {
    const url = new URL(request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw invalidInput(adapterId);
    }
  } catch (error) {
    if (error instanceof ResolverAdapterError) {
      throw error;
    }
    throw invalidInput(adapterId);
  }
}
