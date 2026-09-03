import type { InvidiousOptions } from "@avoid.quest/platforms";
import {
  createPlayablePlatformResolver,
  fetchClientID,
  isPlaylistUrl,
  type PublicStaticAudioUrlFailure,
  resolveStreamUrl,
  toPlayableSources,
  validatePublicStaticAudioUrl,
} from "@avoid.quest/platforms";
import { config } from "../config.js";
import type { QueueTrack } from "./queue.js";

let soundCloudClientId: Promise<string> | null = null;

function getSoundCloudClientId(): Promise<string> {
  soundCloudClientId ??= fetchClientID().catch((error) => {
    soundCloudClientId = null;
    throw error;
  });
  return soundCloudClientId;
}

function getInvidiousOptions(): InvidiousOptions {
  return {
    auth: config.invidiousAuth(),
    instanceUrl: config.invidiousInstanceUrl(),
  };
}

const STATIC_AUDIO_VALIDATION_MESSAGES = {
  "hostname-resolution-failed": "Failed to resolve direct audio host.",
  "internal-address": "Direct audio URLs cannot point to internal addresses.",
  "invalid-protocol": "Direct audio URLs must use HTTP or HTTPS.",
  "invalid-url": "Invalid direct audio URL.",
  "unsupported-url":
    "Direct audio URL must point to a supported audio file or playlist.",
} as const satisfies Record<PublicStaticAudioUrlFailure, string>;

const STATIC_AUDIO_PLAYLIST_UNSUPPORTED_MESSAGE =
  "Discord direct audio URLs must point to an audio file, not a playlist.";

const STATIC_AUDIO_COMMAND_VALIDATION_OPTIONS = {
  resolveHostname: false,
} as const;

export async function resolveStaticAudioItem(normalizedUrl: string): Promise<{
  metadata: {
    platform: "static-audio";
    url: string;
  };
  streamUrl: string;
}> {
  if (isPlaylistUrl(normalizedUrl)) {
    throw new Error(STATIC_AUDIO_PLAYLIST_UNSUPPORTED_MESSAGE);
  }

  const validation = await validatePublicStaticAudioUrl(
    normalizedUrl,
    STATIC_AUDIO_COMMAND_VALIDATION_OPTIONS
  );
  if (!validation.ok) {
    throw new Error(STATIC_AUDIO_VALIDATION_MESSAGES[validation.reason]);
  }

  return {
    metadata: {
      platform: "static-audio" as const,
      url: validation.url,
    },
    streamUrl: validation.url,
  };
}

export async function resolveTrack(
  url: string,
  requestedBy: string
): Promise<QueueTrack | QueueTrack[]> {
  const resolver = createPlayablePlatformResolver({
    invidiousOptions: getInvidiousOptions,
    resolveStaticAudioItem,
  });
  const result = await resolver.resolveItem(url);
  if (!result.success) {
    throw new Error(
      result.error.code === "unsupported-url"
        ? "Unsupported URL. Supported: Bandcamp, SoundCloud, YouTube, Radio Garden, or direct audio file URLs."
        : result.error.message
    );
  }

  const tracks = toPlayableSources(result.item).map((source) => ({
    ...source,
    requestedBy,
  }));

  if (tracks.length === 1) {
    return tracks[0] ?? [];
  }
  return tracks;
}

export function resolveYouTubeStreamUrl(
  videoId: string
): Promise<string | null> {
  return resolveStreamUrl(videoId, getInvidiousOptions());
}

export { getInvidiousOptions, getSoundCloudClientId };
