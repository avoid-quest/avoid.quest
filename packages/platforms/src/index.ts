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
export type {
  BandcampCdnRedirectUrlValidationFailure,
  BandcampCdnRedirectUrlValidationResult,
  BandcampCdnUrlValidationFailure,
  BandcampCdnUrlValidationResult,
} from "./bandcamp/url-policy.js";
export {
  isBandcampCdnHostname,
  isBandcampHostname,
  validateBandcampCdnRedirectUrl,
  validateBandcampCdnUrl,
} from "./bandcamp/url-policy.js";
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
// Radio Garden
export type {
  RadioGardenItemError,
  RadioGardenItemResponse,
  RadioGardenItemResult,
  RadioGardenMetadata,
  RadioGardenSearchResult,
} from "./radiogarden/index.js";
export {
  extractChannelId,
  getRadioGardenItem,
  getRadioGardenSuggestions,
  isRadioGardenUrl,
  resolveRadioGardenStream,
  searchRadioGarden,
} from "./radiogarden/index.js";

// Unified search
export type {
  ExternalPlatformSearchAdapters,
  ExternalPlatformSearchParams,
  SearchablePlatform,
  SearchPlatform,
  SearchResultType,
  UnifiedSearchResponse,
  UnifiedSearchResult,
  YouTubeSearchFilter,
} from "./search.js";
export {
  createExternalPlatformSearchWorkflow,
  transformBandcampResults,
  transformRadioGardenResults,
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
  SoundCloudCdnRedirectUrlValidationFailure,
  SoundCloudCdnRedirectUrlValidationResult,
  SoundCloudCdnUrlValidationFailure,
  SoundCloudCdnUrlValidationResult,
} from "./soundcloud/url-policy.js";
export {
  isSoundCloudCdnHostname,
  isSoundCloudCorsAllowedCdnHostname,
  isSoundCloudHostname,
  isSoundCloudPageHostname,
  validateSoundCloudCdnRedirectUrl,
  validateSoundCloudCdnUrl,
} from "./soundcloud/url-policy.js";
export {
  AUDIO_EXTENSIONS,
  getFilenameFromUrl,
  isAudioUrl,
  isPlaylistUrl,
  isStaticAudioUrl,
  PLAYLIST_EXTENSIONS,
} from "./static-audio.js";
export type {
  Platform,
  PlatformItemError,
  PlatformItemResponse,
  PlatformItemResult,
  PlatformMetadata,
  PlatformTrack,
} from "./types.js";
export { isYouTubeMetadata } from "./types.js";
export type {
  PublicHostnameResolver,
  PublicHttpFetchResult,
  PublicHttpRedirectFailure,
  PublicHttpUrlFailure,
  PublicHttpUrlResult,
  PublicHttpUrlValidationFailure,
  PublicHttpUrlValidationResult,
} from "./url-policy/index.js";
export {
  fetchPublicHttpUrlWithValidatedRedirects,
  isBlockedPublicHttpHostname,
  isPublicHttpUrl,
  resolvePublicHostnameWithDoh,
  validatePublicHttpUrl,
  validatePublicHttpUrlParam,
  validateResolvedPublicHttpUrl,
} from "./url-policy/index.js";

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
