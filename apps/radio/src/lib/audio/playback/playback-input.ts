import {
  isSoundCloudCorsAllowedCdnHostname,
  validateSoundCloudCdnUrl,
} from "@avoid.quest/platforms/soundcloud/url-policy";
import type { PlaybackInput } from "./playback-source.js";
import { inferStreamFormat } from "./stream-format.js";
import type { Radio } from "./types.js";
import { isSameOriginPlaybackPath } from "./url-validation.js";

const RADIO_BLACKOUT_RELAY_URL =
  "https://proxy.cors.sh/https://s.streampunk.cc/blackout.mp3";

const STREAM_URL_OVERRIDES: Readonly<Record<string, string>> = {
  "https://radio.syg.ma/audio.ogg": "https://radio.syg.ma/audio.mp3",
  "https://stream-relay-geo.ntslive.net/stream":
    "https://streams.radiomast.io/nts1",
  "https://stream-relay-geo.ntslive.net/stream2":
    "https://streams.radiomast.io/nts2",
  "https://zeppelin.streampunk.cc/_stream/blackout.mp3":
    RADIO_BLACKOUT_RELAY_URL,
  "https://s.streampunk.cc/blackout.mp3": RADIO_BLACKOUT_RELAY_URL,
  "https://seep.eu.org/https://s.streampunk.cc/blackout.mp3":
    RADIO_BLACKOUT_RELAY_URL,
};

export function toPlaybackInput(radio: Radio): PlaybackInput {
  const src = STREAM_URL_OVERRIDES[radio.streamUrl] ?? radio.streamUrl;
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
  const allowNativeHls =
    format === "hls" &&
    (isSameOriginPlaybackPath(src) || isTrustedSoundCloudHls);
  return {
    ...(allowNativeHls ? { allowNativeHls: true } : {}),
    ...(radio.platformMetadata?.platform === "youtube"
      ? { credentials: "omit" as const }
      : {}),
    format,
    src,
  };
}
