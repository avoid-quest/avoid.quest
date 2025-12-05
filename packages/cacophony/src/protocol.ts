export enum MessageType {
  // Legacy (may be deprecated)
  PLAY = "PLAY",
  PAUSE = "PAUSE",
  STOP = "STOP",
  
  // Parameter control
  SET_PARAM = "SET_PARAM",
  
  // Buffer management
  LOAD_BUFFER = "LOAD_BUFFER",
  REMOVE_BUFFER = "REMOVE_BUFFER",
  
  // Source management
  CREATE_SOURCE = "CREATE_SOURCE",
  REMOVE_SOURCE = "REMOVE_SOURCE",
  
  // Source lifecycle (main → worklet)
  START_SOURCE = "START_SOURCE",
  STOP_SOURCE = "STOP_SOURCE",
  PAUSE_SOURCE = "PAUSE_SOURCE",
  RESUME_SOURCE = "RESUME_SOURCE",
  SEEK_SOURCE = "SEEK_SOURCE",
  SET_SOURCE_VOLUME = "SET_SOURCE_VOLUME",
  SET_SOURCE_PAN = "SET_SOURCE_PAN",
  
  // Streaming
  ADD_STREAM_CHUNK = "ADD_STREAM_CHUNK",
  
  // Events (worklet → main)
  SOURCE_ENDED = "SOURCE_ENDED",
  SOURCE_ERROR = "SOURCE_ERROR",
  STREAM_UNDERRUN = "STREAM_UNDERRUN",
  PEAK_METER = "PEAK_METER",
}

export interface AddStreamChunkPayload {
  sourceId: string;
  chunk: Float32Array[];
}

export interface Message {
  type: MessageType;
  payload?: any;
}

export interface SetParamPayload {
  target: string; // e.g., "channelStrip.volume"
  value: number;
  smooth?: boolean;
}

export interface LoadBufferPayload {
  id: string;
  buffer: Float32Array[]; // Array of channels
  sampleRate: number;
}

export interface CreateSourcePayload {
  id: string;
  bufferId: string;
  options?: {
    loop?: boolean;
    playbackRate?: number;
    volume?: number; // Per-source volume (0-1)
    pan?: number; // Per-source pan (-1 to 1)
  };
}

export interface StartSourcePayload {
  sourceId: string;
  when?: number; // AudioContext time to start (default: now)
  offset?: number; // Position in buffer to start from (seconds)
  duration?: number; // How long to play (seconds, optional)
}

export interface StopSourcePayload {
  sourceId: string;
}

export interface PauseSourcePayload {
  sourceId: string;
}

export interface ResumeSourcePayload {
  sourceId: string;
}

export interface SeekSourcePayload {
  sourceId: string;
  position: number; // Position in seconds
}

export interface SetSourceVolumePayload {
  sourceId: string;
  volume: number;
}

export interface SetSourcePanPayload {
  sourceId: string;
  pan: number;
}

export interface SourceEndedPayload {
  sourceId: string;
  reason: "finished" | "stopped" | "error";
}

export interface SourceErrorPayload {
  sourceId: string;
  error: string;
}

export interface StreamUnderrunPayload {
  sourceId: string;
}

export interface PeakMeterPayload {
  peakL: number;
  peakR: number;
}
