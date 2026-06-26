import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  fetchPublicHttpUrlWithValidatedRedirects,
  type PublicHostnameResolver,
  type PublicHttpRedirectFailure,
} from "@avoid.quest/platforms/url-policy";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type FetchDirectAudioStreamOptions = {
  fetchImpl?: FetchLike;
  resolveHostname?: PublicHostnameResolver | false;
  signal?: AbortSignal;
};

export type DirectAudioStream = {
  resolvedUrl: string;
  stream: Readable;
};

const DIRECT_AUDIO_MAX_REDIRECTS = 5;
const DIRECT_AUDIO_USER_AGENT = "avoid.quest-discord-bot/1.0";

const DIRECT_AUDIO_ERROR_MESSAGES = {
  "invalid-url": "Invalid direct audio URL.",
  "invalid-protocol": "Direct audio URLs must use HTTP or HTTPS.",
  "internal-address": "Direct audio URLs cannot point to internal addresses.",
  "hostname-resolution-failed": "Failed to resolve direct audio host.",
  "missing-location": "Direct audio redirect missing Location header.",
  "too-many-redirects": "Too many direct audio redirects.",
} as const satisfies Record<PublicHttpRedirectFailure, string>;

export class DirectAudioFetchError extends Error {
  readonly reason: PublicHttpRedirectFailure;
  readonly url: string;

  constructor(reason: PublicHttpRedirectFailure, url: string) {
    super(DIRECT_AUDIO_ERROR_MESSAGES[reason]);
    this.name = "DirectAudioFetchError";
    this.reason = reason;
    this.url = url;
  }
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // Some runtimes lock the body once the stream has been handed off.
  }
}

export async function fetchDirectAudioStream(
  url: string,
  {
    fetchImpl = fetch,
    resolveHostname,
    signal,
  }: FetchDirectAudioStreamOptions = {}
): Promise<DirectAudioStream> {
  const redirectResult = await fetchPublicHttpUrlWithValidatedRedirects({
    fetchImpl,
    init: {
      headers: {
        "User-Agent": DIRECT_AUDIO_USER_AGENT,
      },
      signal,
    },
    maxRedirects: DIRECT_AUDIO_MAX_REDIRECTS,
    resolveHostname,
    url,
  });

  if (!redirectResult.ok) {
    throw new DirectAudioFetchError(
      redirectResult.failure.reason,
      redirectResult.failure.url
    );
  }

  if (!redirectResult.response.ok) {
    await cancelBody(redirectResult.response);
    throw new Error(
      `Direct audio fetch failed: ${redirectResult.response.status} ${redirectResult.response.statusText}`
    );
  }

  if (!redirectResult.response.body) {
    throw new Error("Direct audio response did not include a body.");
  }

  return {
    resolvedUrl: redirectResult.resolvedUrl,
    stream: Readable.fromWeb(
      redirectResult.response.body as unknown as NodeReadableStream<Uint8Array>
    ),
  };
}
