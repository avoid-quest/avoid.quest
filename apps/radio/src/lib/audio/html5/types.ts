/**
 * HTML5 Audio Types
 *
 * Types for the simplified HTML5 audio layer (non-DJ modes).
 */

import type { Radio } from "../playback/types.js";

/**
 * Playback state for an HTML5 audio player
 */
export type HTML5AudioState = {
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  error: HTML5AudioError | null;
  hasEnded: boolean;
  currentTime: number;
  duration: number;
};

/**
 * Error information for HTML5 audio
 */
export type HTML5AudioError = {
  message: string;
  code: string;
  radio: Radio;
  timestamp: number;
};

/**
 * Callback for state changes
 */
export type HTML5AudioStateCallback = (state: HTML5AudioState) => void;

/**
 * Initial state for HTML5 audio
 */
export const initialHTML5AudioState: HTML5AudioState = {
  isPlaying: false,
  isLoading: false,
  volume: 1,
  error: null,
  hasEnded: false,
  currentTime: 0,
  duration: 0,
};

/**
 * Configuration for crossfade
 */
export type CrossfadeConfig = {
  duration: number;
  targetVolume: number;
};
