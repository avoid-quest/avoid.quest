import {
  type StreamUrlValidationFailure,
  validatePublicStreamUrl,
} from "@/lib/proxy/url-policy";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class RadioMetadataValidationError extends Error {
  readonly reason: StreamUrlValidationFailure;

  constructor(reason: StreamUrlValidationFailure) {
    super(`Radio metadata URL validation failed: ${reason}`);
    this.reason = reason;
  }
}

export async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // Some runtimes lock the stream once read/cancel has already happened.
  }
}

export function createMetadataUpstreamFetch(fetchImpl: FetchLike) {
  return async function fetchFollowingPublicRedirects(
    url: string,
    init: RequestInit,
    signal: AbortSignal
  ): Promise<Response> {
    let currentUrl = url;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(currentUrl, {
        ...init,
        redirect: "manual",
        signal,
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      await cancelResponseBody(response);
      const nextUrl = new URL(location, currentUrl).toString();
      const validation = validatePublicStreamUrl(nextUrl);
      if (!validation.ok) {
        throw new RadioMetadataValidationError(validation.reason);
      }
      currentUrl = validation.url;
    }

    throw new Error("Radio metadata upstream exceeded redirect limit");
  };
}

export type MetadataUpstreamFetch = ReturnType<
  typeof createMetadataUpstreamFetch
>;
