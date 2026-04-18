/**
 * Message types for worklet communication
 */
export const MessageType = {
  // Source lifecycle
  CREATE_SOURCE: "CREATE_SOURCE",
  REMOVE_SOURCE: "REMOVE_SOURCE",
  START_SOURCE: "START_SOURCE",
  STOP_SOURCE: "STOP_SOURCE",
  PAUSE_SOURCE: "PAUSE_SOURCE",
  RESUME_SOURCE: "RESUME_SOURCE",

  // Volume/Pan
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",
  SET_EFFECTS_DRY_WET: "SET_EFFECTS_DRY_WET",
  SET_PARAM: "SET_PARAM",

  // Filters
  ADD_FILTER: "ADD_FILTER",
  REMOVE_FILTER: "REMOVE_FILTER",
  SET_FILTER_PARAM: "SET_FILTER_PARAM",

  // Effects
  ADD_EFFECT: "ADD_EFFECT",
  REMOVE_EFFECT: "REMOVE_EFFECT",
  UPDATE_EFFECT: "UPDATE_EFFECT",
  REORDER_EFFECTS: "REORDER_EFFECTS",

  // Events (worklet → main)
  SOURCE_ENDED: "SOURCE_ENDED",
  SOURCE_ERROR: "SOURCE_ERROR",
  STREAM_READY: "STREAM_READY",

  // Analysis (worklet → main)
  ANALYSIS_DATA: "ANALYSIS_DATA",
  PEAK_METER: "PEAK_METER",

  // Analysis control (main → worklet)
  ENABLE_ANALYSIS: "ENABLE_ANALYSIS",
} as const;

/**
 * Analysis data payload sent from worklet to main thread
 */
export type AnalysisData = {
  levels: {
    left: number;
    right: number;
    mono: number;
    peak: number;
  };
  spectrum: Float32Array;
  waveform: Float32Array;
};

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/**
 * Error codes for worklet errors
 */
export type WorkletErrorCode =
  | "EFFECT_INIT_FAILED"
  | "EFFECT_PROCESS_FAILED"
  | "SOURCE_NOT_FOUND"
  | "UNKNOWN_ERROR";

/**
 * Generate a unique error ID (worklet-compatible)
 */
export function generateWorkletErrorId(): string {
  return `werr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
