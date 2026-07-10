import { MediaElementPlaybackSource } from "./media-element-playback-source.js";
import type {
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";

function createPlaybackSource(
  context: AudioContext,
  sourceId: string,
  callbacks: PlaybackSourceCallbacks = {}
): PlaybackSource {
  return new MediaElementPlaybackSource(context, sourceId, callbacks);
}

export { createPlaybackSource };
