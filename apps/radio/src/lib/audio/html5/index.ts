/**
 * HTML5 Audio Module
 *
 * Simplified audio playback using HTML5 Audio elements.
 * Used for non-DJ modes (multiple, single).
 */

export {
  CrossfadeController,
  getCrossfadeContext,
  resumeCrossfadeContext,
} from "./crossfade-controller.js";
export { HTML5AudioManager } from "./html5-audio-manager.js";
export { HTML5AudioPlayer } from "./html5-audio-player.js";
export {
  getLoadModeOverride,
  type Html5LoadMode,
  type Html5LoadModeOverride,
  setLoadModeOverride,
} from "./load-mode.js";
export type {
  CrossfadeConfig,
  HTML5AudioError,
  HTML5AudioState,
  HTML5AudioStateCallback,
} from "./types.js";
export { initialHTML5AudioState } from "./types.js";
