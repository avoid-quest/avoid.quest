// Unified types

// Bandcamp
export type {
  BandcampItemError,
  BandcampItemResponse,
  BandcampItemResult,
  BandcampItemType,
  BandcampMetadata,
  BandcampSearchFilter,
  BandcampSearchResult,
  BandcampTrackInfo,
} from "./bandcamp/index.js";
export {
  getBandcampItem,
  getProxiedBandcampUrl,
  searchBandcamp,
} from "./bandcamp/index.js";

// Unified detection
export {
  BANDCAMP_HTML_MARKERS,
  detectBandcampFromHtml,
  detectBandcampItemType,
  detectPlatformFromUrl,
  detectSoundCloudItemType,
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
  isBandcampUrl,
  isSoundCloudUrl,
  isYouTubeUrl,
  needsResolution,
  normalizeBandcampUrl,
  normalizeSoundCloudUrl,
} from "./detect.js";

// Unified search
export type {
  SearchPlatform,
  SearchResultType,
  UnifiedSearchResponse,
  UnifiedSearchResult,
} from "./search.js";
export {
  transformBandcampResults,
  transformSoundCloudResults,
  transformYouTubeResults,
} from "./search.js";
export {
  ClientFetchError,
  fetchClientID,
} from "./soundcloud/fetch-client/index.js";
// SoundCloud
export type {
  SoundCloudItemError,
  SoundCloudItemResponse,
  SoundCloudItemResult,
  SoundCloudItemType,
  SoundCloudMetadata,
  SoundCloudSearchResult,
  SoundCloudTrackInfo,
} from "./soundcloud/index.js";
export {
  getProxiedSoundCloudUrl,
  getSoundCloudItem,
  resolveShortLink,
  searchSoundCloud,
} from "./soundcloud/index.js";
export type {
  Platform,
  PlatformItemError,
  PlatformItemResponse,
  PlatformItemResult,
  PlatformMetadata,
  PlatformTrack,
} from "./types.js";
export { isYouTubeMetadata } from "./types.js";

// YouTube
export type {
  InvidiousAdaptiveFormat,
  InvidiousOptions,
  InvidiousPlaylistResponse,
  InvidiousSearchResult,
  InvidiousVideoResponse,
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeItemType,
  YouTubeMetadata,
  YouTubeSearchResponse,
  YouTubeSearchResult,
  YouTubeTrackInfo,
} from "./youtube/index.js";
export {
  getFullStreamUrl,
  getYouTubeItem,
  resolveStreamUrl,
  searchYouTubeMusic,
} from "./youtube/index.js";
