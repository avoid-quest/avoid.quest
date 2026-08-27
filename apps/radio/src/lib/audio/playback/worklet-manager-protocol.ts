import type {
  SourceEndedPayload,
  SourceErrorPayload,
  StreamReadyPayload,
} from "./types.js";

const MessageType = {
  ADD_EFFECT: "ADD_EFFECT",
  ADD_FILTER: "ADD_FILTER",
  CREATE_SOURCE: "CREATE_SOURCE",
  PAUSE_SOURCE: "PAUSE_SOURCE",
  REMOVE_EFFECT: "REMOVE_EFFECT",
  REMOVE_FILTER: "REMOVE_FILTER",
  REMOVE_SOURCE: "REMOVE_SOURCE",
  REORDER_EFFECTS: "REORDER_EFFECTS",
  RESUME_SOURCE: "RESUME_SOURCE",
  SEEK_SOURCE: "SEEK_SOURCE",
  SET_EFFECTS_DRY_WET: "SET_EFFECTS_DRY_WET",
  SET_FILTER_PARAM: "SET_FILTER_PARAM",
  SET_PARAM: "SET_PARAM",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_TEMPO: "SET_TEMPO",
  SOURCE_ENDED: "SOURCE_ENDED",
  SOURCE_ERROR: "SOURCE_ERROR",
  START_SOURCE: "START_SOURCE",
  STOP_SOURCE: "STOP_SOURCE",
  STREAM_READY: "STREAM_READY",
  UPDATE_EFFECT: "UPDATE_EFFECT",
} as const;

type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

type WorkletManagerEvents = {
  sourceEnded: SourceEndedPayload;
  sourceError: SourceErrorPayload;
  streamReady: StreamReadyPayload;
};

type ActiveSource = {
  playing: boolean;
  offset: number;
};

type WorkletPortMessage = {
  type: string;
  payload?: unknown;
};

export type {
  ActiveSource,
  FilterType,
  WorkletManagerEvents,
  WorkletPortMessage,
};
export { MessageType };
