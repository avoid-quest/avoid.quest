import { isBandcampUrl } from "./bandcamp/detect.js";
import { isRadioGardenUrl } from "./radiogarden/detect.js";
import { isSoundCloudUrl } from "./soundcloud/detect.js";
import type { Platform } from "./types.js";
import { isYouTubeUrl } from "./youtube/detect.js";

export {
  BANDCAMP_HTML_MARKERS,
  detectBandcampFromHtml,
  detectBandcampItemType,
  isBandcampUrl,
  normalizeBandcampUrl,
} from "./bandcamp/detect.js";

export { extractChannelId, isRadioGardenUrl } from "./radiogarden/detect.js";

export {
  detectSoundCloudItemType,
  isSoundCloudUrl,
  needsResolution,
  normalizeSoundCloudUrl,
} from "./soundcloud/detect.js";

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

  if (isRadioGardenUrl(url)) {
    return "radiogarden";
  }

  if (isSoundCloudUrl(url)) {
    return "soundcloud";
  }

  if (isYouTubeUrl(url)) {
    return "youtube";
  }

  return null;
}
