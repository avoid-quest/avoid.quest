import { AppError } from "@avoid.quest/error";
import { streamFormatOf } from "../../source-strip.js";
import { isWebKitBrowser } from "./browser-support.js";
import { MediaElementPlaybackSource } from "./media-element-playback-source.js";
import type {
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";
import {
  isLiveRadioSource,
  type RadioSourceKind,
} from "./radio-source-kind.js";
import type { Radio } from "./types.js";

export type { RadioSourceKind } from "./radio-source-kind.js";

/** Safari's graph receives no samples from live radio or HLS. */
function assertSupportedRadioGraph(
  radio: Radio,
  sourceKind?: RadioSourceKind
): void {
  if (!isWebKitBrowser()) {
    return;
  }
  if (
    isLiveRadioSource(radio, sourceKind) ||
    streamFormatOf(radio, radio.streamUrl) === "hls"
  ) {
    throw new AppError({
      category: "validation",
      code: "UNSUPPORTED_RADIO_GRAPH",
      safeMessage:
        "Safari plays live radio and HLS only in Single, with the default output and zero output delay. Use desktop Chrome or Firefox for Node, DJ and output settings.",
    });
  }
}

function createPlaybackSource(
  context: AudioContext | null,
  sourceId: string,
  callbacks: PlaybackSourceCallbacks = {}
): PlaybackSource {
  return new MediaElementPlaybackSource(context, sourceId, callbacks);
}

export { assertSupportedRadioGraph, createPlaybackSource };
