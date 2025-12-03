/**
 * Centralized types from @avoid.quest/cacophony
 * This file provides a single source of truth for cacophony types used in radio-audio,
 * with proper type compatibility handling.
 */

import type { AudioContext, Cacophony } from "@avoid.quest/cacophony";

// Re-export core types from cacophony
export type {
  AudioContext,
  AudioNode,
  Cacophony,
  GainNode,
  PannerNode,
  Playback,
  Sound,
  SoundType as SoundTypeType,
} from "@avoid.quest/cacophony";
// Re-export enums and constants
export { SoundType } from "@avoid.quest/cacophony";

/**
 * BiquadFilterNode type that matches what createBiquadFilter actually returns.
 * The cacophony BiquadFilterNode type has compatibility issues with the native
 * Web Audio API BiquadFilterNode, so we use the return type of createBiquadFilter.
 */
export type BiquadFilterNode = ReturnType<Cacophony["createBiquadFilter"]>;

/**
 * Derived audio node types from AudioContext.
 * These are commonly used in effects and need to be consistent across the codebase.
 */
export type DelayNode = ReturnType<AudioContext["createDelay"]>;
export type WaveShaperNode = ReturnType<AudioContext["createWaveShaper"]>;
export type DynamicsCompressorNode = ReturnType<
  AudioContext["createDynamicsCompressor"]
>;
export type ConvolverNode = ReturnType<AudioContext["createConvolver"]>;
