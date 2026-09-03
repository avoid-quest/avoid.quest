import type { Radio } from "@/lib/audio";
import {
  inferStreamFormat,
  type StreamFormat,
} from "@/lib/audio/playback/stream-format";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";

type PlaylistTrack = {
  format?: StreamFormat;
  streamUrl: string;
  videoId?: string;
};

function getTrackStreamUrl(track: PlaylistTrack, platform: string): string {
  if (track.streamUrl) {
    const validation = validatePlaybackStreamUrl(track.streamUrl);
    if (validation.ok) {
      return validation.normalizedUrl;
    }
  }

  if (platform === "youtube" && "videoId" in track && track.videoId) {
    const lazyUrl = `yt:${track.videoId}`;
    const validation = validatePlaybackStreamUrl(lazyUrl);
    return validation.ok ? validation.normalizedUrl : "";
  }

  return "";
}

function isSupportedCollectionItem(
  platform: string,
  itemType: string | undefined
): boolean {
  return (
    (platform === "bandcamp" &&
      (itemType === "album" || itemType === "collection")) ||
    (platform === "soundcloud" && itemType === "playlist") ||
    (platform === "youtube" && itemType === "playlist") ||
    (platform === "static-audio" && itemType === "playlist")
  );
}

function findPlayableTrackStreamUrl(
  tracks: PlaylistTrack[],
  platform: string,
  startIndex: number
): { streamFormat: StreamFormat; streamUrl: string } | null {
  for (let index = startIndex; index < tracks.length; index++) {
    const track = tracks[index];
    if (!track) {
      continue;
    }

    const streamUrl = getTrackStreamUrl(track, platform);
    if (streamUrl) {
      return {
        streamFormat: track.format ?? inferStreamFormat(streamUrl),
        streamUrl,
      };
    }
  }

  return null;
}

function findCurrentTrackIndex(
  tracks: PlaylistTrack[],
  currentStreamUrl: string,
  platform: string
): number {
  let index = tracks.findIndex((track) => track.streamUrl === currentStreamUrl);
  if (index !== -1) {
    return index;
  }

  if (platform === "youtube" && currentStreamUrl.startsWith("yt:")) {
    const currentVideoId = currentStreamUrl.slice(3);
    index = tracks.findIndex(
      (track) => "videoId" in track && track.videoId === currentVideoId
    );
  }

  return index;
}

const findNextTrack = (
  radio: Radio | null
): { streamFormat: StreamFormat; streamUrl: string } | null => {
  if (
    !radio?.platformMetadata ||
    radio.platformMetadata.platform === "device-input" ||
    radio.platformMetadata.platform === "local-file"
  ) {
    return null;
  }

  const { platformMetadata } = radio;
  if (!("tracks" in platformMetadata && platformMetadata.tracks)) {
    return null;
  }

  const { tracks, platform, itemType } = platformMetadata;
  if (!isSupportedCollectionItem(platform, itemType) || tracks.length === 0) {
    return null;
  }

  const currentIndex = findCurrentTrackIndex(tracks, radio.streamUrl, platform);
  const searchStartIndex = currentIndex === -1 ? 0 : currentIndex + 1;
  return findPlayableTrackStreamUrl(tracks, platform, searchStartIndex);
};

export { findNextTrack };
