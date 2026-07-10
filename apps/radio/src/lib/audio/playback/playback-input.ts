import type { PlaybackInput } from "./playback-source.js";
import { inferStreamFormat } from "./stream-format.js";
import type { Radio } from "./types.js";

export function toPlaybackInput(radio: Radio): PlaybackInput {
  const format =
    radio.streamFormat ??
    (radio.platformMetadata?.platform === "radio-browser" &&
    radio.platformMetadata.hls
      ? "hls"
      : inferStreamFormat(radio.streamUrl));
  return radio.platformMetadata?.platform === "youtube"
    ? { credentials: "omit", format, src: radio.streamUrl }
    : { format, src: radio.streamUrl };
}
