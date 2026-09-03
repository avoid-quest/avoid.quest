import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as lookupHostname } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  fetchPublicHttpUrlWithValidatedRedirects,
  isBlockedPublicHttpHostname,
  type PublicHostnameResolver,
  type PublicHttpRedirectFailure,
  resolvePublicHostnameWithDoh,
} from "@avoid.quest/platforms/url-policy";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SocketAddressResolver = (
  hostname: string,
  options: LookupOptions
) => Promise<readonly LookupAddress[]>;

type FetchDirectAudioStreamOptions = {
  fetchImpl?: FetchLike;
  headerFetchTimeoutMs?: number;
  resolveHostname?: PublicHostnameResolver | false;
  resolveSocketAddresses?: SocketAddressResolver;
  signal?: AbortSignal;
};

export type DirectAudioStream = {
  resolvedUrl: string;
  stream: Readable;
};

const DIRECT_AUDIO_MAX_REDIRECTS = 5;
const DIRECT_AUDIO_HEADER_FETCH_TIMEOUT_MS = 10_000;
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

export class DirectAudioHeaderTimeoutError extends Error {
  constructor() {
    super("Direct audio header fetch timed out.");
    this.name = "DirectAudioHeaderTimeoutError";
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

function createHeaderFetchSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DirectAudioHeaderTimeoutError());
  }, timeoutMs);

  const abortFromCaller = () => {
    controller.abort(signal?.reason);
  };

  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    },
    signal: controller.signal,
  };
}

function resolveSocketAddressesWithDns(
  hostname: string,
  options: LookupOptions
): Promise<readonly LookupAddress[]> {
  return lookupHostname(hostname, {
    all: true,
    family: options.family,
    hints: options.hints,
  });
}

function createPublicSocketLookup(
  url: string,
  resolveSocketAddresses: SocketAddressResolver
): LookupFunction {
  return (hostname, options, callback) => {
    resolveSocketAddresses(hostname, options)
      .then((addresses) => {
        const publicAddresses = addresses.filter(
          ({ address }) => !isBlockedPublicHttpHostname(address)
        );

        if (publicAddresses.length === 0) {
          callback(new DirectAudioFetchError("internal-address", url), "", 0);
          return;
        }

        if (options.all) {
          callback(null, [...publicAddresses]);
          return;
        }

        const [address] = publicAddresses;
        if (!address) {
          callback(
            new DirectAudioFetchError("hostname-resolution-failed", url),
            "",
            0
          );
          return;
        }

        callback(null, address.address, address.family);
      })
      .catch(() => {
        callback(
          new DirectAudioFetchError("hostname-resolution-failed", url),
          "",
          0
        );
      });
  };
}

function headersToObject(
  headers: HeadersInit | undefined
): Record<string, string> {
  const normalized = new Headers(headers);
  const output: Record<string, string> = {};
  normalized.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function incomingHeadersToHeaders(
  headers: NodeJS.Dict<string | string[]>
): Headers {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(name, item);
      }
      continue;
    }

    if (value !== undefined) {
      responseHeaders.set(name, value);
    }
  }
  return responseHeaders;
}

function createDirectAudioNodeFetch(
  resolveSocketAddresses: SocketAddressResolver
): FetchLike {
  return (input, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input);
      const request = url.protocol === "https:" ? requestHttps : requestHttp;
      const req = request(
        url,
        {
          headers: headersToObject(init.headers),
          lookup: createPublicSocketLookup(input, resolveSocketAddresses),
          method: init.method ?? "GET",
          signal: init.signal ?? undefined,
        },
        (res) => {
          const body = Readable.toWeb(
            res
          ) as unknown as ReadableStream<Uint8Array>;
          resolve(
            new Response(body, {
              headers: incomingHeadersToHeaders(res.headers),
              status: res.statusCode ?? 500,
              statusText: res.statusMessage,
            })
          );
        }
      );

      req.on("error", reject);
      req.end();
    });
}

export async function fetchDirectAudioStream(
  url: string,
  {
    fetchImpl,
    headerFetchTimeoutMs = DIRECT_AUDIO_HEADER_FETCH_TIMEOUT_MS,
    resolveHostname,
    resolveSocketAddresses = resolveSocketAddressesWithDns,
    signal,
  }: FetchDirectAudioStreamOptions = {}
): Promise<DirectAudioStream> {
  const audioFetchImpl =
    fetchImpl ?? createDirectAudioNodeFetch(resolveSocketAddresses);
  const headerFetch = createHeaderFetchSignal(signal, headerFetchTimeoutMs);
  let redirectResult: Awaited<
    ReturnType<typeof fetchPublicHttpUrlWithValidatedRedirects>
  >;

  try {
    redirectResult = await fetchPublicHttpUrlWithValidatedRedirects({
      fetchImpl: audioFetchImpl,
      init: {
        headers: {
          "User-Agent": DIRECT_AUDIO_USER_AGENT,
        },
        signal: headerFetch.signal,
      },
      maxRedirects: DIRECT_AUDIO_MAX_REDIRECTS,
      resolveHostname: resolveHostname ?? resolvePublicHostnameWithDoh,
      url,
    });
  } catch (error) {
    if (headerFetch.signal.reason instanceof DirectAudioHeaderTimeoutError) {
      throw headerFetch.signal.reason;
    }
    throw error;
  } finally {
    headerFetch.cleanup();
  }

  if (!redirectResult.ok) {
    if (headerFetch.signal.reason instanceof DirectAudioHeaderTimeoutError) {
      throw headerFetch.signal.reason;
    }

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
