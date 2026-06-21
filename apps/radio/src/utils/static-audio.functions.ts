/**
 * Static Audio Server Functions
 *
 * Server-side functions for handling remote audio URLs and playlists.
 */

import {
  AppError,
  type AppErrorInit,
  type AppResult,
  type ProblemErrorPayload,
  runServerFn,
} from "@avoid.quest/error";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchStaticAudioPlaylistWorkflow,
  getStaticAudioItemWorkflow,
  probeRemoteAudioWorkflow,
  type RemoteAudioProbe,
  type StaticAudioItem,
  type StaticAudioPlaylist,
} from "@/lib/audio/static-audio-workflow";
import { rateLimitMiddleware } from "./middleware";

export {
  assertPublicStaticAudioUrl,
  fetchStaticAudioWithRedirects,
} from "@/lib/audio/static-audio-workflow";

export type RemoteAudioProbeResponse = AppResult<RemoteAudioProbe>;

const RemoteAudioUrlSchema = z
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
  );

const ProbeRemoteAudioSchema = z.object({ url: RemoteAudioUrlSchema });

const FetchPlaylistSchema = z.object({ url: RemoteAudioUrlSchema });

const GetStaticAudioItemSchema = z.object({ url: RemoteAudioUrlSchema });

export type FetchPlaylistResponse = AppResult<StaticAudioPlaylist>;

export type StaticAudioItemResponse = AppResult<StaticAudioItem>;

function appErrorCategoryForStatus(status: number): AppErrorInit["category"] {
  if (status === 429) {
    return "rate_limit";
  }
  if (status < 500) {
    return "validation";
  }
  return "dependency";
}

function toStaticAudioServerFunctionError(
  error: ProblemErrorPayload
): AppError {
  return new AppError({
    code: error.code,
    safeMessage: error.message,
    category: appErrorCategoryForStatus(error.status),
    expected: error.status < 500,
    status: error.status,
  });
}

async function probeRemoteAudioWithRateLimit(
  url: string
): Promise<RemoteAudioProbe> {
  const result = await probeRemoteAudio({ data: { url } });
  if (result.ok) {
    return result.data;
  }
  throw toStaticAudioServerFunctionError(result.error);
}

async function fetchPlaylistWithRateLimit(
  url: string
): Promise<StaticAudioPlaylist> {
  const result = await fetchPlaylist({ data: { url } });
  if (result.ok) {
    return result.data;
  }
  throw toStaticAudioServerFunctionError(result.error);
}

export const probeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("probe-remote-audio")])
  .validator(ProbeRemoteAudioSchema)
  .handler(
    ({ data }): Promise<RemoteAudioProbeResponse> =>
      runServerFn({
        operation: "probeRemoteAudio",
        fallback: {
          code: "STATIC_AUDIO_PROBE_FAILED",
          safeMessage: "Failed to probe remote audio",
          category: "network",
          expected: false,
          status: 500,
        },
        run: () => probeRemoteAudioWorkflow(data.url),
      })
  );

export const fetchPlaylist = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("fetch-playlist")])
  .validator(FetchPlaylistSchema)
  .handler(
    ({ data }): Promise<FetchPlaylistResponse> =>
      runServerFn({
        operation: "fetchPlaylist",
        fallback: {
          code: "STATIC_AUDIO_FETCH_PLAYLIST_FAILED",
          safeMessage: "Failed to fetch playlist",
          category: "network",
          expected: false,
          status: 500,
        },
        run: () => fetchStaticAudioPlaylistWorkflow(data.url),
      })
  );

export const getStaticAudioItem = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("get-static-audio-item")])
  .validator(GetStaticAudioItemSchema)
  .handler(
    ({ data }): Promise<StaticAudioItemResponse> =>
      runServerFn({
        operation: "getStaticAudioItem",
        fallback: {
          code: "STATIC_AUDIO_ITEM_FAILED",
          safeMessage: "Failed to resolve static audio item",
          category: "dependency",
          expected: false,
          status: 500,
        },
        run: () =>
          getStaticAudioItemWorkflow(data.url, {
            fetchPlaylist: fetchPlaylistWithRateLimit,
            probeRemoteAudio: probeRemoteAudioWithRateLimit,
          }),
      })
  );
