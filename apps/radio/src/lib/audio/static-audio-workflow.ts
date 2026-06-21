import { AppError, type AppErrorInit, toAppError } from "@avoid.quest/error";
import {
  fetchPublicHttpUrlWithValidatedRedirects,
  type PublicHttpRedirectFailure,
} from "@avoid.quest/platforms/url-policy";
import {
  type ParsedPlaylist,
  parsePlaylist,
} from "@/lib/audio/playlist-parser";
import {
  getFilenameFromUrl,
  isAudioUrl,
  isPlaylistUrl,
} from "@/lib/audio/remote-url";
import type {
  StaticAudioMetadata,
  StaticAudioTrack,
} from "@/lib/platform-types";
import {
  type StreamUrlValidationFailure,
  validatePublicStreamUrl,
} from "@/lib/proxy/url-policy";

const REQUEST_TIMEOUT_MS = 15_000;
const STATIC_AUDIO_MAX_REDIRECTS = 5;
const STATIC_AUDIO_USER_AGENT = "Mozilla/5.0 (compatible; avoid.quest/1.0)";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type StaticAudioRedirectFailure = PublicHttpRedirectFailure;

type StaticAudioWorkflowOptions = {
  fetchImpl?: FetchLike;
};

const STATIC_AUDIO_INVALID_URL_ERROR = {
  code: "STATIC_AUDIO_INVALID_URL",
  safeMessage: "Invalid URL",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STATIC_AUDIO_INVALID_PROTOCOL_ERROR = {
  code: "STATIC_AUDIO_INVALID_PROTOCOL",
  safeMessage: "URL must use HTTP or HTTPS",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STATIC_AUDIO_PRIVATE_ADDRESS_ERROR = {
  code: "STATIC_AUDIO_PRIVATE_ADDRESS",
  safeMessage: "URL points to a private/internal network address",
  category: "security",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STATIC_AUDIO_HOSTNAME_RESOLUTION_ERROR = {
  code: "STATIC_AUDIO_HOSTNAME_RESOLUTION_FAILED",
  safeMessage: "Failed to resolve audio URL host",
  category: "validation",
  expected: true,
  status: 400,
} as const satisfies AppErrorInit;

const STATIC_AUDIO_URL_VALIDATION_ERRORS = {
  required: STATIC_AUDIO_INVALID_URL_ERROR,
  "invalid-url": STATIC_AUDIO_INVALID_URL_ERROR,
  "invalid-protocol": STATIC_AUDIO_INVALID_PROTOCOL_ERROR,
  "internal-address": STATIC_AUDIO_PRIVATE_ADDRESS_ERROR,
  "hostname-resolution-failed": STATIC_AUDIO_HOSTNAME_RESOLUTION_ERROR,
} as const satisfies Record<StreamUrlValidationFailure, AppErrorInit>;

const STATIC_AUDIO_REDIRECT_FAILURE_ERRORS = {
  "invalid-url": STATIC_AUDIO_INVALID_URL_ERROR,
  "invalid-protocol": STATIC_AUDIO_INVALID_PROTOCOL_ERROR,
  "internal-address": STATIC_AUDIO_PRIVATE_ADDRESS_ERROR,
  "hostname-resolution-failed": STATIC_AUDIO_HOSTNAME_RESOLUTION_ERROR,
  "missing-location": {
    code: "STATIC_AUDIO_REDIRECT_LOCATION_MISSING",
    safeMessage: "Redirect missing Location header",
    category: "dependency",
    expected: false,
    status: 502,
  },
  "too-many-redirects": {
    code: "STATIC_AUDIO_TOO_MANY_REDIRECTS",
    safeMessage: "Too many redirects",
    category: "dependency",
    expected: false,
    status: 502,
  },
} as const satisfies Record<StaticAudioRedirectFailure, AppErrorInit>;

const STATIC_AUDIO_PROBE_FALLBACK_ERROR = {
  code: "STATIC_AUDIO_PROBE_FAILED",
  safeMessage: "Failed to probe remote audio",
  category: "network",
  expected: false,
  status: 500,
} as const satisfies AppErrorInit;

const STATIC_AUDIO_FETCH_PLAYLIST_FALLBACK_ERROR = {
  code: "STATIC_AUDIO_FETCH_PLAYLIST_FAILED",
  safeMessage: "Failed to fetch playlist",
  category: "network",
  expected: false,
  status: 500,
} as const satisfies AppErrorInit;

export type RemoteAudioProbe = {
  contentType: string;
  contentLength: number | null;
  filename: string;
};

export type StaticAudioPlaylist = {
  playlist: ParsedPlaylist;
};

export type StaticAudioItem = {
  metadata: StaticAudioMetadata;
  streamUrl: string;
};

export function assertPublicStaticAudioUrl(url: string): void {
  const validation = validatePublicStreamUrl(url);
  if (validation.ok) {
    return;
  }

  throw new AppError(STATIC_AUDIO_URL_VALIDATION_ERRORS[validation.reason]);
}

function createStaticAudioRedirectError(
  reason: StaticAudioRedirectFailure
): AppError {
  return new AppError(STATIC_AUDIO_REDIRECT_FAILURE_ERRORS[reason]);
}

function createAbortTimeoutError(error: AppErrorInit): AppError {
  return new AppError(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function withStaticAudioTimeout<T>({
  run,
  timeoutError,
}: {
  run: (signal: AbortSignal) => Promise<T>;
  timeoutError: AppErrorInit;
}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw createAbortTimeoutError(timeoutError);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runStaticAudioDependency<T>({
  code,
  fallback,
  run,
}: {
  code: string;
  fallback: AppErrorInit;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const appError = toAppError(error, fallback);
    throw new AppError({
      code,
      safeMessage: appError.safeMessage,
      category: "dependency",
      expected: true,
      status: appError.status,
      cause: appError,
    });
  }
}

export async function fetchStaticAudioWithRedirects(
  url: string,
  {
    fetchImpl = fetch,
    headers,
    method,
    signal,
  }: {
    fetchImpl?: FetchLike;
    headers?: HeadersInit;
    method: "GET" | "HEAD";
    signal?: AbortSignal;
  }
): Promise<Response> {
  const redirectResult = await fetchPublicHttpUrlWithValidatedRedirects({
    fetchImpl,
    init: {
      headers,
      method,
      signal,
    },
    maxRedirects: STATIC_AUDIO_MAX_REDIRECTS,
    url,
  });

  if (!redirectResult.ok) {
    throw createStaticAudioRedirectError(redirectResult.failure.reason);
  }

  return redirectResult.response;
}

export function probeRemoteAudioWorkflow(
  url: string,
  { fetchImpl }: StaticAudioWorkflowOptions = {}
): Promise<RemoteAudioProbe> {
  assertPublicStaticAudioUrl(url);

  return withStaticAudioTimeout({
    timeoutError: {
      code: "STATIC_AUDIO_PROBE_TIMEOUT",
      safeMessage: "Request timed out",
      category: "network",
      expected: true,
      status: 408,
    },
    run: async (signal) => {
      const response = await fetchStaticAudioWithRedirects(url, {
        fetchImpl,
        method: "HEAD",
        signal,
        headers: {
          "User-Agent": STATIC_AUDIO_USER_AGENT,
        },
      });

      if (!response.ok) {
        throw new AppError({
          code: "STATIC_AUDIO_PROBE_HTTP_ERROR",
          safeMessage: `HTTP ${response.status}: ${response.statusText}`,
          category: "network",
          expected: true,
          status: 502,
        });
      }

      const contentType = response.headers.get("content-type") || "audio/mpeg";
      const contentLengthStr = response.headers.get("content-length");
      const contentLength = contentLengthStr
        ? Number.parseInt(contentLengthStr, 10)
        : null;

      return {
        contentType,
        contentLength,
        filename: getFilenameFromUrl(url),
      };
    },
  });
}

export function fetchStaticAudioPlaylistWorkflow(
  url: string,
  { fetchImpl }: StaticAudioWorkflowOptions = {}
): Promise<StaticAudioPlaylist> {
  assertPublicStaticAudioUrl(url);

  return withStaticAudioTimeout({
    timeoutError: {
      code: "STATIC_AUDIO_PLAYLIST_TIMEOUT",
      safeMessage: "Request timed out",
      category: "network",
      expected: true,
      status: 408,
    },
    run: async (signal) => {
      const response = await fetchStaticAudioWithRedirects(url, {
        fetchImpl,
        method: "GET",
        signal,
        headers: {
          "User-Agent": STATIC_AUDIO_USER_AGENT,
        },
      });

      if (!response.ok) {
        throw new AppError({
          code: "STATIC_AUDIO_PLAYLIST_HTTP_ERROR",
          safeMessage: `HTTP ${response.status}: ${response.statusText}`,
          category: "network",
          expected: true,
          status: 502,
        });
      }

      const content = await response.text();
      const playlist = parsePlaylist(content, url);

      if (playlist.tracks.length === 0) {
        throw new AppError({
          code: "STATIC_AUDIO_PLAYLIST_EMPTY",
          safeMessage: "No tracks found in playlist",
          category: "validation",
          expected: true,
          status: 400,
        });
      }

      return { playlist };
    },
  });
}

function createPlaylistMetadata(
  url: string,
  playlist: ParsedPlaylist
): StaticAudioItem {
  const tracks: StaticAudioTrack[] = playlist.tracks.map((track) => ({
    title: track.title,
    streamUrl: track.url,
    duration: track.duration,
    requiresProxy: true,
  }));

  const firstTrack = tracks[0];
  if (!firstTrack) {
    throw new AppError({
      code: "STATIC_AUDIO_PLAYLIST_EMPTY",
      safeMessage: "No tracks found in playlist",
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  const playlistName = getFilenameFromUrl(url);
  const metadata: StaticAudioMetadata = {
    platform: "static-audio",
    itemType: "playlist",
    url,
    fileName: playlistName,
    displayName: playlistName,
    duration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    fileSize: 0,
    mimeType: "audio/x-mpegurl",
    streamUrl: firstTrack.streamUrl,
    isLocal: false,
    requiresProxy: true,
    tracks,
    playlistName,
    playlistFormat: playlist.format,
  };

  return {
    metadata,
    streamUrl: firstTrack.streamUrl,
  };
}

function createTrackMetadata(
  url: string,
  probe: RemoteAudioProbe
): StaticAudioItem {
  const metadata: StaticAudioMetadata = {
    platform: "static-audio",
    itemType: "track",
    url,
    fileName: `${probe.filename}.mp3`,
    displayName: probe.filename,
    duration: 0,
    fileSize: probe.contentLength ?? 0,
    mimeType: probe.contentType,
    streamUrl: url,
    isLocal: false,
    requiresProxy: true,
  };

  return {
    metadata,
    streamUrl: url,
  };
}

export async function getStaticAudioItemWorkflow(
  url: string,
  options: StaticAudioWorkflowOptions = {}
): Promise<StaticAudioItem> {
  assertPublicStaticAudioUrl(url);
  const trimmedUrl = url.trim();

  if (isPlaylistUrl(trimmedUrl)) {
    const playlistResult = await runStaticAudioDependency({
      code: "STATIC_AUDIO_PLAYLIST_RESOLVE_FAILED",
      fallback: STATIC_AUDIO_FETCH_PLAYLIST_FALLBACK_ERROR,
      run: () => fetchStaticAudioPlaylistWorkflow(trimmedUrl, options),
    });

    return createPlaylistMetadata(trimmedUrl, playlistResult.playlist);
  }

  if (isAudioUrl(trimmedUrl)) {
    const probeResult = await runStaticAudioDependency({
      code: "STATIC_AUDIO_PROBE_FAILED",
      fallback: STATIC_AUDIO_PROBE_FALLBACK_ERROR,
      run: () => probeRemoteAudioWorkflow(trimmedUrl, options),
    });

    return createTrackMetadata(trimmedUrl, probeResult);
  }

  throw new AppError({
    code: "STATIC_AUDIO_UNSUPPORTED_URL",
    safeMessage: "URL does not point to a supported audio file or playlist",
    category: "validation",
    expected: true,
    status: 400,
  });
}
