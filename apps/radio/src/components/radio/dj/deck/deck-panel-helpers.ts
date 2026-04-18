import { toast } from "sonner";
import type {
  BandcampMetadata,
  PlatformMetadata,
  SoundCloudMetadata,
  YouTubeMetadata,
} from "@/lib/platform-types";
import { youtubeResolveStream } from "@/utils/youtube.functions";

export function isStreamingMetadata(
  metadata?: PlatformMetadata
): metadata is BandcampMetadata | SoundCloudMetadata | YouTubeMetadata {
  return (
    metadata !== undefined &&
    metadata.platform !== "device-input" &&
    metadata.platform !== "local-file"
  );
}

export function calculateHasTracklist(metadata?: PlatformMetadata): boolean {
  if (!isStreamingMetadata(metadata)) {
    return false;
  }
  const hasTracks = Boolean(metadata.tracks && metadata.tracks.length > 0);
  if (!hasTracks) {
    return false;
  }

  if (metadata.platform === "bandcamp") {
    return (
      metadata.itemType === "album" ||
      metadata.itemType === "artist" ||
      metadata.itemType === "collection"
    );
  }
  if (metadata.platform === "soundcloud") {
    return metadata.itemType === "playlist" || metadata.itemType === "user";
  }
  if (metadata.platform === "youtube") {
    return metadata.itemType === "playlist";
  }
  return false;
}

export async function resolveYouTubePlaylistTrack(
  videoId: string,
  tracks?: { streamUrl: string; videoId?: string }[]
): Promise<string | null> {
  const result = await youtubeResolveStream({ data: { videoId } });
  if (!result.ok) {
    toast.error(result.error.message);
    return null;
  }
  const { stream } = result.data;
  if (!stream) {
    toast.error("Failed to resolve YouTube stream");
    return null;
  }
  if (tracks) {
    const track = tracks.find((t) => "videoId" in t && t.videoId === videoId);
    if (track) {
      track.streamUrl = stream.streamUrl;
    }
  }
  return stream.streamUrl;
}
