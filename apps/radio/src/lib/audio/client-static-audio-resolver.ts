import {
  isLoopbackHttpUrl,
  isPublicHttpUrl,
} from "@avoid.quest/platforms/url-policy";
import { getCompatibilityFallbacksEnabled } from "@/lib/compatibility-fallback-policy";
import type {
  StaticAudioMetadata,
  StaticAudioTrack,
} from "@/lib/platform-types";
import { getStreamRelayUrls } from "@/lib/relay";
import { inferStreamFormat } from "./playback/stream-format.js";
import { type ParsedPlaylist, parsePlaylist } from "./playlist-parser.js";
import { getFilenameFromUrl, isAudioUrl, isPlaylistUrl } from "./remote-url.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const BYTE_ORDER_MARK_PATTERN = /^\uFEFF/;
const HLS_DIRECTIVE_PATTERN = /^#EXT-X-/m;
const HTML_PATTERN = /^\s*(?:<!doctype\s+html|<html|<body)/i;
const PLAYLIST_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/pls+xml",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/m3u",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "audio/x-scpls",
  "text/plain",
]);
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type ClientStaticAudioAttemptKind = "app-server" | "direct" | "relay";

export type ClientStaticAudioAttemptFailure = {
  code:
    | "aborted"
    | "http-error"
    | "invalid-content"
    | "invalid-content-type"
    | "network-error"
    | "response-too-large"
    | "timeout";
  kind: ClientStaticAudioAttemptKind;
  message: string;
  url: string;
};

export type ClientStaticAudioResolution = {
  attemptFailures: ClientStaticAudioAttemptFailure[];
  format: "hls" | "progressive";
  metadata: StaticAudioMetadata;
  streamUrl: string;
};

export type ClientStaticAudioResolverDependencies = {
  allowCompatibilityFallbacks?: boolean;
  appServerFallback?: (
    upstreamUrl: string,
    init: RequestInit
  ) => Promise<Response>;
  fetchImpl?: FetchLike;
  getRelayUrls?: (
    upstreamUrl: string,
    format: "hls" | "progressive"
  ) => readonly string[];
  maxResponseBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

class CandidateFailure extends Error {
  readonly code: ClientStaticAudioAttemptFailure["code"];

  constructor(
    code: ClientStaticAudioAttemptFailure["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.code = code;
    this.name = "CandidateFailure";
  }
}

class CandidateAttemptError extends Error {
  readonly failure: ClientStaticAudioAttemptFailure;

  constructor(failure: ClientStaticAudioAttemptFailure) {
    super(failure.message);
    this.failure = failure;
    this.name = "CandidateAttemptError";
  }
}

export class ClientStaticAudioResolverError extends Error {
  readonly attemptFailures: ClientStaticAudioAttemptFailure[];

  constructor(
    message: string,
    attemptFailures: ClientStaticAudioAttemptFailure[] = [],
    options?: ErrorOptions
  ) {
    super(message, options);
    this.attemptFailures = attemptFailures;
    this.name = "ClientStaticAudioResolverError";
  }
}

type Candidate = {
  fetch: (init: RequestInit) => Promise<Response>;
  kind: ClientStaticAudioAttemptKind;
  url: string;
};

function appServerCandidates(
  upstreamUrl: string,
  fallback: ClientStaticAudioResolverDependencies["appServerFallback"],
  enabled: boolean
): Candidate[] {
  return fallback && enabled
    ? [
        {
          fetch: (init) => fallback(upstreamUrl, init),
          kind: "app-server",
          url: upstreamUrl,
        },
      ]
    : [];
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new ClientStaticAudioResolverError("Audio URL is invalid", [], {
      cause: error,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ClientStaticAudioResolverError(
      "Audio URL must use HTTP or HTTPS"
    );
  }
  if (url.username || url.password) {
    throw new ClientStaticAudioResolverError(
      "Audio URL must not contain credentials"
    );
  }
  return url;
}

function extension(url: URL): string {
  const filename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

function trackMetadata(url: string, mimeType: string): StaticAudioMetadata {
  const displayName = getFilenameFromUrl(url) || "Unknown";
  return {
    displayName,
    duration: 0,
    fileName: displayName,
    fileSize: 0,
    isLocal: false,
    itemType: "track",
    mimeType,
    platform: "static-audio",
    streamUrl: url,
    url,
  };
}

function metadataFormat(
  metadata: StaticAudioMetadata
): ClientStaticAudioResolution["format"] {
  if (
    metadata.itemType === "track" &&
    metadata.mimeType === "application/vnd.apple.mpegurl"
  ) {
    return "hls";
  }
  return inferStreamFormat(metadata.streamUrl);
}

function playlistMetadata(
  url: string,
  playlist: ParsedPlaylist
): StaticAudioMetadata {
  const tracks: StaticAudioTrack[] = playlist.tracks.map((track) => ({
    duration: track.duration,
    format: inferStreamFormat(track.url),
    streamUrl: track.url,
    title: track.title,
  }));
  const firstTrack = tracks[0];
  if (!firstTrack) {
    throw new CandidateFailure(
      "invalid-content",
      "Playlist contains no tracks"
    );
  }
  const displayName = getFilenameFromUrl(url) || "Unknown";
  return {
    displayName,
    duration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    fileName: displayName,
    fileSize: 0,
    isLocal: false,
    itemType: "playlist",
    mimeType: playlist.format === "pls" ? "audio/x-scpls" : "audio/x-mpegurl",
    platform: "static-audio",
    playlistFormat: playlist.format,
    playlistName: displayName,
    streamUrl: firstTrack.streamUrl,
    tracks,
    url,
  };
}

function validateTrackUrls(
  playlist: ParsedPlaylist,
  upstreamUrl: string
): void {
  const allowLoopback = isLoopbackHttpUrl(upstreamUrl);
  for (const track of playlist.tracks) {
    let url: URL;
    try {
      url = new URL(track.url);
    } catch (error) {
      throw new CandidateFailure(
        "invalid-content",
        "Playlist contains an invalid track URL",
        {
          cause: error,
        }
      );
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      throw new CandidateFailure(
        "invalid-content",
        "Playlist contains an unsafe track URL"
      );
    }
    if (
      !(
        isPublicHttpUrl(track.url) ||
        (allowLoopback && isLoopbackHttpUrl(track.url))
      )
    ) {
      throw new CandidateFailure(
        "invalid-content",
        "Playlist contains a private track URL"
      );
    }
  }
}

function parsePlaylistContent(
  content: string,
  upstreamUrl: string,
  expectedExtension: string
): StaticAudioMetadata {
  const normalized = content.replace(BYTE_ORDER_MARK_PATTERN, "").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    HTML_PATTERN.test(normalized)
  ) {
    throw new CandidateFailure(
      "invalid-content",
      "Response is not a valid audio playlist"
    );
  }

  if (HLS_DIRECTIVE_PATTERN.test(normalized)) {
    return trackMetadata(upstreamUrl, "application/vnd.apple.mpegurl");
  }

  const playlist = parsePlaylist(normalized, upstreamUrl);
  if (expectedExtension === ".pls" && playlist.format !== "pls") {
    throw new CandidateFailure(
      "invalid-content",
      "Response is not a valid PLS playlist"
    );
  }
  validateTrackUrls(playlist, upstreamUrl);
  return playlistMetadata(upstreamUrl, playlist);
}

function validateContentType(response: Response): void {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!PLAYLIST_CONTENT_TYPES.has(contentType ?? "")) {
    throw new CandidateFailure(
      "invalid-content-type",
      `Unexpected playlist content type: ${contentType || "unknown"}`
    );
  }
}

async function readLimitedText(
  response: Response,
  maxResponseBytes: number
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new CandidateFailure(
      "response-too-large",
      `Playlist exceeds ${maxResponseBytes} bytes`
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxResponseBytes) {
        await reader.cancel();
        throw new CandidateFailure(
          "response-too-large",
          `Playlist exceeds ${maxResponseBytes} bytes`
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof CandidateFailure) {
      throw error;
    }
    throw new CandidateFailure(
      "invalid-content",
      "Playlist response is not valid UTF-8 text",
      {
        cause: error,
      }
    );
  } finally {
    reader.releaseLock();
  }
}

function createRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): { cleanup: () => void; signal: AbortSignal; timedOut: () => boolean } {
  const controller = new AbortController();
  let timeoutExpired = false;
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) {
    abort();
  }
  const timeoutId = setTimeout(() => {
    timeoutExpired = true;
    controller.abort(
      new DOMException("Playlist request timed out", "TimeoutError")
    );
  }, timeoutMs);

  return {
    cleanup: () => {
      clearTimeout(timeoutId);
      parent?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
    timedOut: () => timeoutExpired,
  };
}

function candidateFailure(
  candidate: Candidate,
  error: unknown,
  timedOut: boolean,
  parentAborted: boolean
): ClientStaticAudioAttemptFailure {
  if (error instanceof CandidateFailure) {
    return {
      code: error.code,
      kind: candidate.kind,
      message: error.message,
      url: candidate.url,
    };
  }
  if (timedOut || parentAborted) {
    return {
      code: timedOut ? "timeout" : "aborted",
      kind: candidate.kind,
      message: timedOut
        ? "Playlist request timed out"
        : "Playlist request was aborted",
      url: candidate.url,
    };
  }
  return {
    code: "network-error",
    kind: candidate.kind,
    message: error instanceof Error ? error.message : "Playlist request failed",
    url: candidate.url,
  };
}

function requestInit(signal: AbortSignal): RequestInit {
  return {
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept:
        "audio/x-mpegurl, audio/x-scpls, application/vnd.apple.mpegurl, text/plain;q=0.9",
    },
    referrerPolicy: "no-referrer",
    signal,
  };
}

function runUntilAbort<T>(
  run: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    run().then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

async function resolveCandidate(
  candidate: Candidate,
  upstreamUrl: string,
  expectedExtension: string,
  timeoutMs: number,
  maxResponseBytes: number,
  parentSignal?: AbortSignal
): Promise<StaticAudioMetadata> {
  const requestSignal = createRequestSignal(parentSignal, timeoutMs);
  try {
    return await runUntilAbort(async () => {
      const response = await candidate.fetch(requestInit(requestSignal.signal));
      if (!response.ok) {
        throw new CandidateFailure(
          "http-error",
          `Playlist request failed with status ${response.status}`
        );
      }
      validateContentType(response);
      return parsePlaylistContent(
        await readLimitedText(response, maxResponseBytes),
        upstreamUrl,
        expectedExtension
      );
    }, requestSignal.signal);
  } catch (error) {
    throw new CandidateAttemptError(
      candidateFailure(
        candidate,
        error,
        requestSignal.timedOut(),
        parentSignal?.aborted ?? false
      )
    );
  } finally {
    requestSignal.cleanup();
  }
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ClientStaticAudioResolverError(`${label} must be positive`);
  }
  return value;
}

export async function resolveClientStaticAudio(
  value: string,
  dependencies: ClientStaticAudioResolverDependencies = {}
): Promise<ClientStaticAudioResolution> {
  const parsedUrl = parseUrl(value);
  const upstreamUrl = parsedUrl.toString();
  const expectedExtension = extension(parsedUrl);

  if (isAudioUrl(upstreamUrl)) {
    const metadata = trackMetadata(
      upstreamUrl,
      MIME_TYPES[expectedExtension] ?? "audio/mpeg"
    );
    return {
      attemptFailures: [],
      format: metadataFormat(metadata),
      metadata,
      streamUrl: upstreamUrl,
    };
  }
  if (!isPlaylistUrl(upstreamUrl)) {
    throw new ClientStaticAudioResolverError(
      "URL does not point to a supported audio file or playlist"
    );
  }

  const timeoutMs = positiveLimit(
    dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "Resolver timeout"
  );
  const maxResponseBytes = positiveLimit(
    dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "Maximum response size"
  );
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const format = expectedExtension === ".m3u8" ? "hls" : "progressive";
  const getRelayUrls = dependencies.getRelayUrls ?? getStreamRelayUrls;
  const relayFormats =
    format === "hls"
      ? (["hls", "progressive"] as const)
      : (["progressive", "hls"] as const);
  const relayUrls = [
    ...new Set(
      relayFormats.flatMap((relayFormat) =>
        getRelayUrls(upstreamUrl, relayFormat)
      )
    ),
  ];
  const candidates: Candidate[] = [
    {
      fetch: (init) => fetchImpl(upstreamUrl, init),
      kind: "direct",
      url: upstreamUrl,
    },
    ...relayUrls.map((url) => ({
      fetch: (init: RequestInit) => fetchImpl(url, init),
      kind: "relay" as const,
      url,
    })),
    ...appServerCandidates(
      upstreamUrl,
      dependencies.appServerFallback,
      dependencies.allowCompatibilityFallbacks ??
        getCompatibilityFallbacksEnabled()
    ),
  ];

  const attemptFailures: ClientStaticAudioAttemptFailure[] = [];
  for (const candidate of candidates) {
    try {
      const metadata = await resolveCandidate(
        candidate,
        upstreamUrl,
        expectedExtension,
        timeoutMs,
        maxResponseBytes,
        dependencies.signal
      );
      return {
        attemptFailures,
        format: metadataFormat(metadata),
        metadata,
        streamUrl: metadata.streamUrl,
      };
    } catch (error) {
      if (error instanceof CandidateAttemptError) {
        attemptFailures.push(error.failure);
      } else {
        attemptFailures.push(candidateFailure(candidate, error, false, false));
      }
      if (dependencies.signal?.aborted) {
        break;
      }
    }
  }

  throw new ClientStaticAudioResolverError(
    "Unable to read the audio playlist in this browser",
    attemptFailures
  );
}
