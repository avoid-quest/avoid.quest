import {
  isSoundCloudCorsAllowedCdnHostname,
  validateSoundCloudCdnUrl,
} from "@avoid.quest/platforms/soundcloud/url-policy";
import type { PlaybackInput } from "./playback-source.js";
import { inferStreamFormat } from "./stream-format.js";
import type { Radio } from "./types.js";
import { isSameOriginPlaybackPath } from "./url-validation.js";

export function toPlaybackInput(radio: Radio): PlaybackInput {
  const format =
    radio.streamFormat ??
    (radio.platformMetadata?.platform === "radio-browser" &&
    radio.platformMetadata.hls
      ? "hls"
      : inferStreamFormat(radio.streamUrl));
  const soundCloudValidation = validateSoundCloudCdnUrl(radio.streamUrl);
  const isTrustedSoundCloudHls =
    radio.platformMetadata?.platform === "soundcloud" &&
    soundCloudValidation.ok &&
    soundCloudValidation.parsed.protocol === "https:" &&
    isSoundCloudCorsAllowedCdnHostname(soundCloudValidation.parsed.hostname);
  const allowNativeHls =
    format === "hls" &&
    (isSameOriginPlaybackPath(radio.streamUrl) || isTrustedSoundCloudHls);
  return {
    ...(allowNativeHls ? { allowNativeHls: true } : {}),
    ...(radio.platformMetadata?.platform === "youtube"
      ? { credentials: "omit" as const }
      : {}),
    format,
    src: radio.streamUrl,
  };
}
