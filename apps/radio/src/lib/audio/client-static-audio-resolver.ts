import { AppError } from "@avoid.quest/error";
import {
  cachePublicHostnameResolver,
  isPublicHttpUrl,
  type PublicHostnameResolver,
  resolvePublicHostnameWithDoh,
  validateResolvedPublicHttpUrl,
} from "@avoid.quest/platforms/url-policy";
import type {
  StaticAudioMetadata,
  StaticAudioTrack,
} from "@/lib/platform-types";
import { inferStreamFormat } from "./playback/stream-format.js";
import { type ParsedPlaylist, parsePlaylist } from "./playlist-parser.js";
import { getFilenameFromUrl, isAudioUrl, isPlaylistUrl } from "./remote-url.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PLAYLIST_RESOURCES = 1000;
const BYTE_ORDER_MARK_PATTERN = /^\uFEFF/;
const HLS_DIRECTIVE_PATTERN = /^#EXT-X-/m;
const HLS_URI_ATTRIBUTE_PATTERN = /[,:](?:URI|SERVER-URI)="([^"]+)"/g;
const HTML_PATTERN = /^\s*(?:<!doctype\s+html|<html|<body)/i;
const LINE_BREAK_PATTERN = /\r?\n/;
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

export type ClientStaticAudioResolution = {
  format: "hls" | "progressive";
  metadata: StaticAudioMetadata;
  streamUrl: string;
};

export type ClientStaticAudioResolverDependencies = {
  fetchImpl?: FetchLike;
  maxResponseBytes?: number;
  resolveHostname?: PublicHostnameResolver | false;
  signal?: AbortSignal;
  timeoutMs?: number;
};

class PlaylistError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlaylistError";
  }
}

export class ClientStaticAudioResolverError extends AppError {
  constructor(
    message: string,
    options?: ErrorOptions & { expected?: boolean; cancelled?: boolean }
  ) {
    const category = options?.expected ? "validation" : "dependency";
    super({
      category: options?.cancelled ? "cancellation" : category,
      cause: options?.cause,
      code: "STATIC_AUDIO_CLIENT_RESOLUTION_FAILED",
      expected: options?.expected ?? options?.cancelled ?? false,
      safeMessage: message,
    });
    this.name = "ClientStaticAudioResolverError";
  }
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new ClientStaticAudioResolverError("Audio URL is invalid", {
      cause: error,
      expected: true,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ClientStaticAudioResolverError(
      "Audio URL must use HTTP or HTTPS",
      { expected: true }
    );
  }
  if (url.username || url.password) {
    throw new ClientStaticAudioResolverError(
      "Audio URL must not contain credentials",
      { expected: true }
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
  const [firstTrack] = tracks;
  if (!firstTrack) {
    throw new PlaylistError("Playlist contains no tracks");
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

async function validatePlaylistResourceUrl(
  value: string,
  resolveHostname: PublicHostnameResolver | false,
  signal: AbortSignal,
  baseUrl?: string
): Promise<void> {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch (error) {
    throw new PlaylistError("Playlist contains an invalid resource URL", {
      cause: error,
    });
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new PlaylistError("Playlist contains an unsafe resource URL");
  }
  if (!isPublicHttpUrl(url.toString())) {
    throw new PlaylistError("Playlist contains a private resource URL");
  }
  const validation = await validateResolvedPublicHttpUrl(url.toString(), {
    resolveHostname,
    signal,
  });
  if (!validation.ok) {
    throw new PlaylistError("Playlist contains a private resource URL");
  }
}

async function validateTrackUrls(
  playlist: ParsedPlaylist,
  resolveHostname: PublicHostnameResolver | false,
  signal: AbortSignal
): Promise<void> {
  if (playlist.tracks.length > MAX_PLAYLIST_RESOURCES) {
    throw new PlaylistError("Playlist contains too many resources");
  }
  for (const track of playlist.tracks) {
    // biome-ignore lint/performance/noAwaitInLoops: bound hostname lookups and fail at the first unsafe URL
    await validatePlaylistResourceUrl(track.url, resolveHostname, signal);
  }
}

async function validateHlsResourceUrls(
  content: string,
  manifestUrl: string,
  resolveHostname: PublicHostnameResolver | false,
  signal: AbortSignal
): Promise<void> {
  const resourceUrls: string[] = [];
  for (const line of content.split(LINE_BREAK_PATTERN)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      resourceUrls.push(trimmed);
    }
    for (const match of line.matchAll(HLS_URI_ATTRIBUTE_PATTERN)) {
      resourceUrls.push(match[1] ?? "");
    }
    if (resourceUrls.length > MAX_PLAYLIST_RESOURCES) {
      throw new PlaylistError("Playlist contains too many resources");
    }
  }
  for (const resourceUrl of resourceUrls) {
    // biome-ignore lint/performance/noAwaitInLoops: bound hostname lookups and fail at the first unsafe URL
    await validatePlaylistResourceUrl(
      resourceUrl,
      resolveHostname,
      signal,
      manifestUrl
    );
  }
}

async function parsePlaylistContent(
  content: string,
  upstreamUrl: string,
  expectedExtension: string,
  resolveHostname: PublicHostnameResolver | false,
  signal: AbortSignal
): Promise<StaticAudioMetadata> {
  const normalized = content.replace(BYTE_ORDER_MARK_PATTERN, "").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    HTML_PATTERN.test(normalized)
  ) {
    throw new PlaylistError("Response is not a valid audio playlist");
  }

  if (HLS_DIRECTIVE_PATTERN.test(normalized)) {
    await validateHlsResourceUrls(
      normalized,
      upstreamUrl,
      resolveHostname,
      signal
    );
    return trackMetadata(upstreamUrl, "application/vnd.apple.mpegurl");
  }

  const playlist = parsePlaylist(normalized, upstreamUrl);
  if (expectedExtension === ".pls" && playlist.format !== "pls") {
    throw new PlaylistError("Response is not a valid PLS playlist");
  }
  await validateTrackUrls(playlist, resolveHostname, signal);
  return playlistMetadata(upstreamUrl, playlist);
}

function validateContentType(response: Response): void {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!PLAYLIST_CONTENT_TYPES.has(contentType ?? "")) {
    throw new PlaylistError(
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
    throw new PlaylistError(`Playlist exceeds ${maxResponseBytes} bytes`);
  }

  const { body } = response;
  if (!body) {
    return "";
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    await body.pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          bytesRead += chunk.byteLength;
          if (bytesRead > maxResponseBytes) {
            throw new PlaylistError(
              `Playlist exceeds ${maxResponseBytes} bytes`
            );
          }
          text += decoder.decode(chunk, { stream: true });
        },
      })
    );
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof PlaylistError) {
      throw error;
    }
    throw new PlaylistError("Playlist response is not valid UTF-8 text", {
      cause: error,
    });
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

function resolverError(
  error: unknown,
  timedOut: boolean,
  parentAborted: boolean
): ClientStaticAudioResolverError {
  if (error instanceof PlaylistError) {
    return new ClientStaticAudioResolverError(error.message, { cause: error });
  }
  if (timedOut || parentAborted) {
    return new ClientStaticAudioResolverError(
      timedOut ? "Playlist request timed out" : "Playlist request was aborted",
      { cancelled: parentAborted && !timedOut, cause: error }
    );
  }
  return new ClientStaticAudioResolverError(
    error instanceof Error ? error.message : "Playlist request failed",
    { cause: error }
  );
}

async function validateUpstreamHost(
  upstreamUrl: string,
  resolveHostname: PublicHostnameResolver | false,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<void> {
  const requestSignal = createRequestSignal(parentSignal, timeoutMs);
  try {
    const validation = await runUntilAbort(
      () =>
        validateResolvedPublicHttpUrl(upstreamUrl, {
          resolveHostname,
          signal: requestSignal.signal,
        }),
      requestSignal.signal
    );
    if (!validation.ok) {
      throw new ClientStaticAudioResolverError(
        "Audio URL must resolve to a public host",
        { expected: validation.reason !== "hostname-resolution-failed" }
      );
    }
  } catch (error) {
    if (error instanceof ClientStaticAudioResolverError) {
      throw error;
    }
    throw resolverError(
      error,
      requestSignal.timedOut(),
      parentSignal?.aborted ?? false
    );
  } finally {
    requestSignal.cleanup();
  }
}

function requestInit(signal: AbortSignal): RequestInit {
  return {
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept:
        "audio/x-mpegurl, audio/x-scpls, application/vnd.apple.mpegurl, text/plain;q=0.9",
    },
    redirect: "error",
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

async function resolvePlaylist(
  fetchImpl: FetchLike,
  upstreamUrl: string,
  expectedExtension: string,
  timeoutMs: number,
  maxResponseBytes: number,
  resolveHostname: PublicHostnameResolver | false,
  parentSignal?: AbortSignal
): Promise<StaticAudioMetadata> {
  const requestSignal = createRequestSignal(parentSignal, timeoutMs);
  try {
    return await runUntilAbort(async () => {
      const response = await fetchImpl(
        upstreamUrl,
        requestInit(requestSignal.signal)
      );
      if (!response.ok) {
        throw new PlaylistError(
          `Playlist request failed with status ${response.status}`
        );
      }
      validateContentType(response);
      return parsePlaylistContent(
        await readLimitedText(response, maxResponseBytes),
        upstreamUrl,
        expectedExtension,
        resolveHostname,
        requestSignal.signal
      );
    }, requestSignal.signal);
  } catch (error) {
    throw resolverError(
      error,
      requestSignal.timedOut(),
      parentSignal?.aborted ?? false
    );
  } finally {
    requestSignal.cleanup();
  }
}

async function probeDirectAudio(
  fetchImpl: FetchLike,
  upstreamUrl: string,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<void> {
  const requestSignal = createRequestSignal(parentSignal, timeoutMs);
  try {
    await runUntilAbort(async () => {
      const response = await fetchImpl(upstreamUrl, {
        ...requestInit(requestSignal.signal),
        headers: { Accept: "audio/*", Range: "bytes=0-0" },
        method: "GET",
      });
      if (!response.ok) {
        throw new PlaylistError(
          `Audio request failed with status ${response.status}`
        );
      }
      await response.body?.cancel();
    }, requestSignal.signal);
  } catch (error) {
    throw resolverError(
      error,
      requestSignal.timedOut(),
      parentSignal?.aborted ?? false
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
  const audioUrl = isAudioUrl(upstreamUrl);
  const playlistUrl = isPlaylistUrl(upstreamUrl);

  if (!(audioUrl || playlistUrl)) {
    throw new ClientStaticAudioResolverError(
      "URL does not point to a supported audio file or playlist",
      { expected: true }
    );
  }
  if (!isPublicHttpUrl(upstreamUrl)) {
    throw new ClientStaticAudioResolverError("Audio URL must be public", {
      expected: true,
    });
  }
  const timeoutMs = positiveLimit(
    dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "Resolver timeout"
  );
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const hostnameResolver =
    dependencies.resolveHostname ??
    (fetchImpl === globalThis.fetch ? resolvePublicHostnameWithDoh : false);
  const resolveHostname =
    hostnameResolver === false
      ? false
      : cachePublicHostnameResolver(hostnameResolver);
  await validateUpstreamHost(
    upstreamUrl,
    resolveHostname,
    timeoutMs,
    dependencies.signal
  );
  if (audioUrl) {
    await probeDirectAudio(
      fetchImpl,
      upstreamUrl,
      timeoutMs,
      dependencies.signal
    );
    const metadata = trackMetadata(
      upstreamUrl,
      MIME_TYPES[expectedExtension] ?? "audio/mpeg"
    );
    return {
      format: metadataFormat(metadata),
      metadata,
      streamUrl: upstreamUrl,
    };
  }

  const maxResponseBytes = positiveLimit(
    dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "Maximum response size"
  );
  const metadata = await resolvePlaylist(
    fetchImpl,
    upstreamUrl,
    expectedExtension,
    timeoutMs,
    maxResponseBytes,
    resolveHostname,
    dependencies.signal
  );
  return {
    format: metadataFormat(metadata),
    metadata,
    streamUrl: metadata.streamUrl,
  };
}
