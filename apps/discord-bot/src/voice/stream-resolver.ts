import type { InvidiousOptions } from "@avoid.quest/platforms";
import {
  createPlayablePlatformResolver,
  fetchClientID,
  resolveStreamUrl,
  toPlayableSources,
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
    instanceUrl: config.invidiousInstanceUrl(),
    auth: config.invidiousAuth(),
  };
}

export async function resolveTrack(
  url: string,
  requestedBy: string
): Promise<QueueTrack | QueueTrack[]> {
  const resolver = createPlayablePlatformResolver({
    invidiousOptions: getInvidiousOptions,
    resolveStaticAudioItem: async (normalizedUrl: string) => ({
      metadata: {
        platform: "static-audio" as const,
        url: normalizedUrl,
      },
      streamUrl: normalizedUrl,
    }),
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
