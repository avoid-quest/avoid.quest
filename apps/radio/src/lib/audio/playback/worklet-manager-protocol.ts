import type {
  SourceEndedPayload,
  SourceErrorPayload,
  StreamReadyPayload,
} from "./types.js";

const MessageType = {
  CREATE_SOURCE: "CREATE_SOURCE",
  REMOVE_SOURCE: "REMOVE_SOURCE",
  START_SOURCE: "START_SOURCE",
  STOP_SOURCE: "STOP_SOURCE",
  PAUSE_SOURCE: "PAUSE_SOURCE",
  RESUME_SOURCE: "RESUME_SOURCE",
  SEEK_SOURCE: "SEEK_SOURCE",
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",
  ADD_EFFECT: "ADD_EFFECT",
  REMOVE_EFFECT: "REMOVE_EFFECT",
  UPDATE_EFFECT: "UPDATE_EFFECT",
  REORDER_EFFECTS: "REORDER_EFFECTS",
  SET_EFFECTS_DRY_WET: "SET_EFFECTS_DRY_WET",
  ADD_FILTER: "ADD_FILTER",
  REMOVE_FILTER: "REMOVE_FILTER",
  SET_FILTER_PARAM: "SET_FILTER_PARAM",
  SET_PARAM: "SET_PARAM",
  SOURCE_ENDED: "SOURCE_ENDED",
  SOURCE_ERROR: "SOURCE_ERROR",
  STREAM_READY: "STREAM_READY",
  PEAK_METER: "PEAK_METER",
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
  peakMeter: { peakL: number; peakR: number };
};

type ActiveSource = {
  playing: boolean;
  offset: number;
};

type WorkletPortMessage = {
  type: string;
  payload?: unknown;
};

export { MessageType };
export type {
  ActiveSource,
  FilterType,
  WorkletManagerEvents,
  WorkletPortMessage,
};
