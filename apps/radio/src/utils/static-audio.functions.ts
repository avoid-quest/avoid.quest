/**
 * Static Audio Server Functions
 *
 * Server-side functions for handling remote audio URLs and playlists.
 */

import { type AppResult, runServerFn } from "@avoid.quest/error";
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

export const probeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("probe-remote-audio")])
  .inputValidator(ProbeRemoteAudioSchema)
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
  .inputValidator(FetchPlaylistSchema)
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
  .inputValidator(GetStaticAudioItemSchema)
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
        run: () => getStaticAudioItemWorkflow(data.url),
      })
  );
