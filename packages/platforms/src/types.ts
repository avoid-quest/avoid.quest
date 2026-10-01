import type {
  BandcampItemError,
  BandcampItemResult,
  BandcampMetadata,
  BandcampTrackInfo,
} from "./bandcamp/types.js";
import type {
  MixcloudItemError,
  MixcloudItemResult,
  MixcloudMetadata,
} from "./mixcloud/types.js";
import type {
  RadioGardenItemError,
  RadioGardenItemResult,
  RadioGardenMetadata,
} from "./radiogarden/types.js";
import type {
  SoundCloudItemError,
  SoundCloudItemResult,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
} from "./soundcloud/types.js";
import type {
  SpotifyItemError,
  SpotifyItemResult,
  SpotifyMetadata,
  SpotifyTrackInfo,
} from "./spotify/types.js";
import type {
  YouTubeItemError,
  YouTubeItemResult,
  YouTubeMetadata,
  YouTubeTrackInfo,
} from "./youtube/types.js";

export type Platform =
  | "bandcamp"
  | "mixcloud"
  | "radiogarden"
  | "soundcloud"
  | "spotify"
  | "youtube";

export type PlatformMetadata =
  | BandcampMetadata
  | MixcloudMetadata
  | RadioGardenMetadata
  | SoundCloudMetadata
  | SpotifyMetadata
  | YouTubeMetadata;

export type PlatformTrack =
  | BandcampTrackInfo
  | SoundCloudTrackInfo
  | SpotifyTrackInfo
  | YouTubeTrackInfo;

export type PlatformItemResult =
  | BandcampItemResult
  | MixcloudItemResult
  | RadioGardenItemResult
  | SoundCloudItemResult
  | SpotifyItemResult
  | YouTubeItemResult;

export type PlatformItemError =
  | BandcampItemError
  | MixcloudItemError
  | RadioGardenItemError
  | SoundCloudItemError
  | SpotifyItemError
  | YouTubeItemError;

export type PlatformItemResponse = PlatformItemResult | PlatformItemError;

export function isYouTubeMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is YouTubeMetadata {
  return metadata?.platform === "youtube";
}
