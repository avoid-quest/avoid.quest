/**
 * Static Audio Server Functions
 *
 * Server-side functions for handling remote audio URLs and playlists.
 */

import { AppError, type AppResult, runServerFn } from "@avoid.quest/error";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
import { rateLimitMiddleware } from "./middleware";

const REQUEST_TIMEOUT_MS = 15_000;
const IP_OCTET_RE = /^\d{1,3}$/;

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => IP_OCTET_RE.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10) {
      return true;
    }
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 127) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 0) {
      return true;
    }
  }

  return false;
}

function assertUrlNotPrivate(url: string): void {
  try {
    const parsed = new URL(url);
    if (isPrivateHostname(parsed.hostname)) {
      throw new AppError({
        code: "STATIC_AUDIO_PRIVATE_ADDRESS",
        safeMessage: "URL points to a private/internal network address",
        category: "security",
        expected: true,
        status: 400,
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError({
      code: "STATIC_AUDIO_INVALID_URL",
      safeMessage: "Invalid URL",
      category: "validation",
      expected: true,
      status: 400,
    });
  }
}

export type RemoteAudioProbeResponse = AppResult<{
  contentType: string;
  contentLength: number | null;
  filename: string;
}>;

const ProbeRemoteAudioSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long")
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Invalid URL format" }
    ),
});

const FetchPlaylistSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long")
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Invalid URL format" }
    ),
});

const GetStaticAudioItemSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long")
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Invalid URL format" }
    ),
});

export type FetchPlaylistResponse = AppResult<{
  playlist: ParsedPlaylist;
}>;

export type StaticAudioItemResponse = AppResult<{
  metadata: StaticAudioMetadata;
  streamUrl: string;
}>;

export const probeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("probe-remote-audio")])
  .inputValidator(ProbeRemoteAudioSchema)
  .handler(({ data }): Promise<RemoteAudioProbeResponse> => {
    return runServerFn({
      operation: "probeRemoteAudio",
      fallback: {
        code: "STATIC_AUDIO_PROBE_FAILED",
        safeMessage: "Failed to probe remote audio",
        category: "network",
        expected: false,
        status: 500,
      },
      run: async () => {
        assertUrlNotPrivate(data.url);

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          REQUEST_TIMEOUT_MS
        );

        try {
          const response = await fetch(data.url, {
            method: "HEAD",
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; avoid.quest/1.0)",
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

          const contentType =
            response.headers.get("content-type") || "audio/mpeg";
          const contentLengthStr = response.headers.get("content-length");
          const contentLength = contentLengthStr
            ? Number.parseInt(contentLengthStr, 10)
            : null;

          return {
            contentType,
            contentLength,
            filename: getFilenameFromUrl(data.url),
          };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new AppError({
              code: "STATIC_AUDIO_PROBE_TIMEOUT",
              safeMessage: "Request timed out",
              category: "network",
              expected: true,
              status: 408,
            });
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
    });
  });

export const fetchPlaylist = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("fetch-playlist")])
  .inputValidator(FetchPlaylistSchema)
  .handler(({ data }): Promise<FetchPlaylistResponse> => {
    return runServerFn({
      operation: "fetchPlaylist",
      fallback: {
        code: "STATIC_AUDIO_FETCH_PLAYLIST_FAILED",
        safeMessage: "Failed to fetch playlist",
        category: "network",
        expected: false,
        status: 500,
      },
      run: async () => {
        assertUrlNotPrivate(data.url);

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          REQUEST_TIMEOUT_MS
        );

        try {
          const response = await fetch(data.url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; avoid.quest/1.0)",
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
          const playlist = parsePlaylist(content, data.url);

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
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new AppError({
              code: "STATIC_AUDIO_PLAYLIST_TIMEOUT",
              safeMessage: "Request timed out",
              category: "network",
              expected: true,
              status: 408,
            });
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
    });
  });

export const getStaticAudioItem = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("get-static-audio-item")])
  .inputValidator(GetStaticAudioItemSchema)
  .handler(({ data }): Promise<StaticAudioItemResponse> => {
    return runServerFn({
      operation: "getStaticAudioItem",
      fallback: {
        code: "STATIC_AUDIO_ITEM_FAILED",
        safeMessage: "Failed to resolve static audio item",
        category: "dependency",
        expected: false,
        status: 500,
      },
      run: async () => {
        assertUrlNotPrivate(data.url);
        const trimmedUrl = data.url.trim();

        if (isPlaylistUrl(trimmedUrl)) {
          const playlistResult = await fetchPlaylist({
            data: { url: trimmedUrl },
          });
          if (!playlistResult.ok) {
            throw new AppError({
              code: "STATIC_AUDIO_PLAYLIST_RESOLVE_FAILED",
              safeMessage: playlistResult.error.message,
              category: "dependency",
              expected: true,
              status: playlistResult.error.status,
            });
          }

          const tracks: StaticAudioTrack[] =
            playlistResult.data.playlist.tracks.map((track) => ({
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

          const metadata: StaticAudioMetadata = {
            platform: "static-audio",
            itemType: "playlist",
            url: trimmedUrl,
            fileName: getFilenameFromUrl(trimmedUrl),
            displayName: getFilenameFromUrl(trimmedUrl),
            duration: tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0),
            fileSize: 0,
            mimeType: "audio/x-mpegurl",
            streamUrl: firstTrack.streamUrl,
            isLocal: false,
            requiresProxy: true,
            tracks,
            playlistName: getFilenameFromUrl(trimmedUrl),
            playlistFormat: playlistResult.data.playlist.format,
          };

          return {
            metadata,
            streamUrl: firstTrack.streamUrl,
          };
        }

        if (isAudioUrl(trimmedUrl)) {
          const probeResult = await probeRemoteAudio({
            data: { url: trimmedUrl },
          });

          if (!probeResult.ok) {
            throw new AppError({
              code: "STATIC_AUDIO_PROBE_FAILED",
              safeMessage: probeResult.error.message,
              category: "dependency",
              expected: true,
              status: probeResult.error.status,
            });
          }

          const metadata: StaticAudioMetadata = {
            platform: "static-audio",
            itemType: "track",
            url: trimmedUrl,
            fileName: `${probeResult.data.filename}.mp3`,
            displayName: probeResult.data.filename,
            duration: 0,
            fileSize: probeResult.data.contentLength ?? 0,
            mimeType: probeResult.data.contentType,
            streamUrl: trimmedUrl,
            isLocal: false,
            requiresProxy: true,
          };

          return {
            metadata,
            streamUrl: trimmedUrl,
          };
        }

        throw new AppError({
          code: "STATIC_AUDIO_UNSUPPORTED_URL",
          safeMessage:
            "URL does not point to a supported audio file or playlist",
          category: "validation",
          expected: true,
          status: 400,
        });
      },
    });
  });
