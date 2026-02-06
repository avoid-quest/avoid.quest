import type {
  BandcampItemError,
  BandcampItemResult,
  BandcampMetadata,
  BandcampTrackInfo,
} from "./bandcamp/types.js";
import type {
  SoundCloudItemError,
  SoundCloudItemResult,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
} from "./soundcloud/types.js";
import type {
  YouTubeItemError,
  YouTubeItemResult,
  YouTubeMetadata,
  YouTubeTrackInfo,
} from "./youtube/types.js";

export type Platform = "bandcamp" | "soundcloud" | "youtube";

export type PlatformMetadata =
  | BandcampMetadata
  | SoundCloudMetadata
  | YouTubeMetadata;

export type PlatformTrack =
  | BandcampTrackInfo
  | SoundCloudTrackInfo
  | YouTubeTrackInfo;

export type PlatformItemResult =
  | BandcampItemResult
  | SoundCloudItemResult
  | YouTubeItemResult;

export type PlatformItemError =
  | BandcampItemError
  | SoundCloudItemError
  | YouTubeItemError;

export type PlatformItemResponse = PlatformItemResult | PlatformItemError;

export function isYouTubeMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is YouTubeMetadata {
  return metadata?.platform === "youtube";
}
