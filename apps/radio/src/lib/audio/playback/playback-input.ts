import { validateMixcloudStreamUrl } from "@avoid.quest/platforms/mixcloud/url-policy";
import {
  isSoundCloudCorsAllowedCdnHostname,
  validateSoundCloudCdnUrl,
} from "@avoid.quest/platforms/soundcloud/url-policy";
import type { PlaybackInput } from "./playback-source.js";
import {
  isRadioBlackoutStreamUrl,
  RADIO_BLACKOUT_STREAM_URL,
} from "./radio-blackout.js";
import { inferStreamFormat } from "./stream-format.js";
import type { Radio } from "./types.js";
import { isSameOriginPlaybackPath } from "./url-validation.js";

const STREAM_URL_OVERRIDES: Readonly<Record<string, string>> = {
  "https://radio.syg.ma/audio.ogg": "https://radio.syg.ma/audio.mp3",
  "https://stream-relay-geo.ntslive.net/stream":
    "https://streams.radiomast.io/nts1",
  "https://stream-relay-geo.ntslive.net/stream2":
    "https://streams.radiomast.io/nts2",
};

export function toPlaybackInput(radio: Radio): PlaybackInput {
  const src = isRadioBlackoutStreamUrl(radio.streamUrl)
    ? RADIO_BLACKOUT_STREAM_URL
    : (STREAM_URL_OVERRIDES[radio.streamUrl] ?? radio.streamUrl);
  const format =
    radio.streamFormat ??
    (radio.platformMetadata?.platform === "radio-browser" &&
    radio.platformMetadata.hls
      ? "hls"
      : inferStreamFormat(src));
  const soundCloudValidation = validateSoundCloudCdnUrl(src);
  const isTrustedSoundCloudHls =
    radio.platformMetadata?.platform === "soundcloud" &&
    soundCloudValidation.ok &&
    soundCloudValidation.parsed.protocol === "https:" &&
    isSoundCloudCorsAllowedCdnHostname(soundCloudValidation.parsed.hostname);
  // Mixcloud's stream hosts send ACAO * (see mixcloud/RESEARCH.md).
  const isTrustedMixcloudHls =
    radio.platformMetadata?.platform === "mixcloud" &&
    validateMixcloudStreamUrl(src).ok;
  const allowNativeHls =
    format === "hls" &&
    (isSameOriginPlaybackPath(src) ||
      isTrustedSoundCloudHls ||
      isTrustedMixcloudHls);
  // Spotify plays the matched YouTube upload's stream.
  const isYouTubeStream =
    radio.platformMetadata?.platform === "youtube" ||
    radio.platformMetadata?.platform === "spotify";
  return {
    ...(allowNativeHls ? { allowNativeHls: true } : {}),
    ...(isYouTubeStream ? { credentials: "omit" as const } : {}),
    format,
    src,
  };
}
