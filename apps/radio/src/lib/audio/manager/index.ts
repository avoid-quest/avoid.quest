export {
  AUDIO_ENGINE_FACADE_PUBLIC_METHOD_BUDGET,
  type AudioEngineFacade,
  countAudioEngineFacadeMethods,
  createAudioEngineFacade,
} from "./audio-engine-facade.js";
/**
 * Audio Manager Module
 *
 * High-level API for audio playback with effects.
 */

export {
  AudioManager,
  type FilterConfig,
  setWorkletProcessorUrl,
} from "./audio-manager.js";

export {
  type CrossfadeCurve,
  type CrossfadeOptions,
  crossfade,
  duckSound,
  fadeIn,
  fadeOut,
} from "./crossfade.js";
