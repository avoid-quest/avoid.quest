/**
 * Static Audio Server Functions
 *
 * Server-side functions for handling remote audio URLs and playlists.
 */

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

// Types
export type RemoteAudioProbeResult =
  | {
      success: true;
      contentType: string;
      contentLength: number | null;
      filename: string;
    }
  | {
      success: false;
      error: string;
    };

export type StaticAudioItemResponse =
  | {
      success: true;
      metadata: StaticAudioMetadata;
      streamUrl: string;
    }
  | {
      success: false;
      error: string;
    };

// Schemas
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

/**
 * Probe a remote audio URL for metadata (content-type, size)
 */
export const probeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("probe-remote-audio")])
  .inputValidator(ProbeRemoteAudioSchema)
  .handler(async ({ data }): Promise<RemoteAudioProbeResult> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      const response = await fetch(data.url, {
        method: "HEAD",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; avoid.quest/1.0)",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") || "audio/mpeg";
      const contentLengthStr = response.headers.get("content-length");
      const contentLength = contentLengthStr
        ? Number.parseInt(contentLengthStr, 10)
        : null;

      return {
        success: true,
        contentType,
        contentLength,
        filename: getFilenameFromUrl(data.url),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { success: false, error: "Request timed out" };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

/**
 * Fetch and parse a remote playlist file
 */
export const fetchPlaylist = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("fetch-playlist")])
  .inputValidator(FetchPlaylistSchema)
  .handler(async ({ data }): Promise<ParsedPlaylist | { error: string }> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      const response = await fetch(data.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; avoid.quest/1.0)",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const content = await response.text();
      const playlist = parsePlaylist(content, data.url);

      if (playlist.tracks.length === 0) {
        return { error: "No tracks found in playlist" };
      }

      return playlist;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { error: "Request timed out" };
      }
      return {
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

/**
 * Get static audio item metadata from a URL
 * Similar to loadPlatformItem but for direct audio/playlist URLs
 */
export const getStaticAudioItem = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("get-static-audio-item")])
  .inputValidator(GetStaticAudioItemSchema)
  .handler(async ({ data }): Promise<StaticAudioItemResponse> => {
    const trimmedUrl = data.url.trim();

    // Handle playlist URLs
    if (isPlaylistUrl(trimmedUrl)) {
      const playlistResult = await fetchPlaylist({ data: { url: trimmedUrl } });

      if ("error" in playlistResult) {
        return { success: false, error: playlistResult.error };
      }

      const tracks: StaticAudioTrack[] = playlistResult.tracks.map((track) => ({
        title: track.title,
        streamUrl: track.url,
        duration: track.duration,
        requiresProxy: true, // Assume remote URLs need proxy
      }));

      const firstTrack = tracks[0];
      if (!firstTrack) {
        return { success: false, error: "No tracks found in playlist" };
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
        playlistFormat: playlistResult.format,
      };

      return {
        success: true,
        metadata,
        streamUrl: firstTrack.streamUrl,
      };
    }

    // Handle single audio URLs
    if (isAudioUrl(trimmedUrl)) {
      const probeResult = await probeRemoteAudio({
        data: { url: trimmedUrl },
      });

      if (!probeResult.success) {
        return { success: false, error: probeResult.error };
      }

      const metadata: StaticAudioMetadata = {
        platform: "static-audio",
        itemType: "track",
        url: trimmedUrl,
        fileName: `${probeResult.filename}.mp3`,
        displayName: probeResult.filename,
        duration: 0, // Can't determine without loading audio
        fileSize: probeResult.contentLength ?? 0,
        mimeType: probeResult.contentType,
        streamUrl: trimmedUrl,
        isLocal: false,
        requiresProxy: true, // Assume remote URLs need proxy for CORS
      };

      return {
        success: true,
        metadata,
        streamUrl: trimmedUrl,
      };
    }

    return {
      success: false,
      error: "URL does not point to a supported audio file or playlist",
    };
  });
