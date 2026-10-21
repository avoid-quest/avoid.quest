/**
 * Audio Manager Module
 *
 * High-level API for audio playback with effects.
 */

export {
  type AudioEngineFacade,
  createAudioEngineFacade,
} from "./audio-engine-facade.js";
export {
  AudioManager,
  type FilterConfig,
} from "./audio-manager.js";
export { fadeOut } from "./crossfade.js";
export { captureMobileAudioDiagnostic } from "./mobile-audio-diagnostic.js";
