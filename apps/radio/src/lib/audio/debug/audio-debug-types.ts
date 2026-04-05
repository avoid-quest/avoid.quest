import type { Html5LoadMode } from "../html5/load-mode.js";

export type AudioDebugMode = "single" | "multiple" | "dj" | "unknown";

export type AudioDebugDeliveryPath =
  | "direct"
  | "no-cors"
  | "proxied"
  | "unknown";

export type AudioDebugProcessingPath =
  | "html5"
  | "web-audio"
  | "worklet"
  | "bypass";

export type AudioDebugEventName =
  | "loadstart"
  | "loadedmetadata"
  | "canplay"
  | "canplaythrough"
  | "playing"
  | "waiting"
  | "stalled"
  | "suspend"
  | "progress"
  | "error";

export type AudioDebugEventCounts = Record<AudioDebugEventName, number>;

export type AudioDebugEventEntry = {
  name: AudioDebugEventName;
  at: number;
  readyState: number | null;
  networkState: number | null;
  bufferedAheadSec: number | null;
  currentTime: number | null;
};

export type AudioDebugContextState = "suspended" | "running" | "closed";

export type AudioDebugContextSnapshot = {
  state: AudioDebugContextState;
  sampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  updatedAt: number;
};

export type AudioDebugSnapshot = {
  id: string;
  mode: AudioDebugMode;
  stationName: string | null;
  radioId: string | number | null;
  streamUrl: string | null;
  currentSrc: string | null;
  host: string;
  loadMode: Html5LoadMode | null;
  deliveryPath: AudioDebugDeliveryPath;
  processingPath: AudioDebugProcessingPath;
  crossOrigin: string | null;
  readyState: number | null;
  networkState: number | null;
  bufferedAheadSec: number | null;
  eventCounts: AudioDebugEventCounts;
  recentEvents: AudioDebugEventEntry[];
  totalBufferingMs: number;
  maxGapMs: number;
  firstPlayableMs: number | null;
  waitingSinceMs: number | null;
  lastActivityAt: number | null;
  lastTelemetryAt: number | null;
  context: AudioDebugContextSnapshot | null;
  usesWorklet: boolean;
  workletActive: boolean;
  workletBypassed: boolean;
  effectsActive: boolean;
  filterActive: boolean;
  createdAt: number;
  lastUpdatedAt: number;
};
