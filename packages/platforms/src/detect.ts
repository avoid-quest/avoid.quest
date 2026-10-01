import { isBandcampUrl } from "./bandcamp/detect.js";
import { isMixcloudUrl } from "./mixcloud/detect.js";
import { isRadioGardenUrl } from "./radiogarden/detect.js";
import { isSoundCloudUrl } from "./soundcloud/detect.js";
import { isSpotifyUrl } from "./spotify/detect.js";
import type { Platform } from "./types.js";
import { isYouTubeUrl } from "./youtube/detect.js";

export {
  BANDCAMP_HTML_MARKERS,
  detectBandcampFromHtml,
  detectBandcampItemType,
  isBandcampUrl,
  normalizeBandcampUrl,
} from "./bandcamp/detect.js";

export type { MixcloudShowRef } from "./mixcloud/detect.js";
export {
  getMixcloudShowUrl,
  isMixcloudShowUrl,
  isMixcloudUrl,
  normalizeMixcloudUrl,
  parseMixcloudShowUrl,
} from "./mixcloud/detect.js";

export { extractChannelId, isRadioGardenUrl } from "./radiogarden/detect.js";

export {
  detectSoundCloudItemType,
  isSoundCloudUrl,
  needsResolution,
  normalizeSoundCloudUrl,
} from "./soundcloud/detect.js";

export type { SpotifyRef } from "./spotify/detect.js";
export {
  detectSpotifyItemType,
  getSpotifyUrl,
  isSpotifyUrl,
  needsSpotifyResolution,
  normalizeSpotifyUrl,
  parseSpotifyRef,
  parseSpotifyTrackPlaceholder,
} from "./spotify/detect.js";

export {
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
  isYouTubeUrl,
} from "./youtube/detect.js";

/**
 * Detects the external platform from a URL string.
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  if (isBandcampUrl(url)) {
    return "bandcamp";
  }

  if (isMixcloudUrl(url)) {
    return "mixcloud";
  }

  if (isRadioGardenUrl(url)) {
    return "radiogarden";
  }

  if (isSoundCloudUrl(url)) {
    return "soundcloud";
  }

  if (isSpotifyUrl(url)) {
    return "spotify";
  }

  if (isYouTubeUrl(url)) {
    return "youtube";
  }

  return null;
}
