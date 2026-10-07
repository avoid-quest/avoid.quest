/**
 * Message types for worklet communication
 */
export const MessageType = {
  // Effects
  ADD_EFFECT: "ADD_EFFECT",

  // Source lifecycle
  CREATE_SOURCE: "CREATE_SOURCE",

  PAUSE_SOURCE: "PAUSE_SOURCE",
  REMOVE_EFFECT: "REMOVE_EFFECT",
  REMOVE_SOURCE: "REMOVE_SOURCE",
  REORDER_EFFECTS: "REORDER_EFFECTS",
  RESUME_SOURCE: "RESUME_SOURCE",
  SET_EFFECTS_DRY_WET: "SET_EFFECTS_DRY_WET",
  SET_PARAM: "SET_PARAM",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",

  // Volume/Pan
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_TEMPO: "SET_TEMPO",

  // Events (worklet → main)
  SOURCE_ENDED: "SOURCE_ENDED",
  SOURCE_ERROR: "SOURCE_ERROR",
  START_SOURCE: "START_SOURCE",
  STOP_SOURCE: "STOP_SOURCE",
  STREAM_READY: "STREAM_READY",
  UPDATE_EFFECT: "UPDATE_EFFECT",
} as const;

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
