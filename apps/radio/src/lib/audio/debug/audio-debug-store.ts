import { capturePlaybackError, hostFromUrl } from "@avoid.quest/error";
import { useSyncExternalStore } from "react";
import {
  getLoadModeOverride,
  type Html5LoadMode,
  type Html5LoadModeOverride,
  setLoadModeOverride as persistLoadModeOverride,
} from "../html5/load-mode.js";
import type { Radio } from "../playback/types.js";
import type {
  AudioDebugContextSnapshot,
  AudioDebugDeliveryPath,
  AudioDebugEventCounts,
  AudioDebugEventEntry,
  AudioDebugEventName,
  AudioDebugMode,
  AudioDebugProcessingPath,
  AudioDebugSnapshot,
} from "./audio-debug-types.js";

const DEBUG_QUERY_PARAM = "audioDebug";
const RECENT_EVENT_LIMIT = 24;
const DIAGNOSTIC_CLUSTER_THRESHOLD = 3;
const DIAGNOSTIC_MIN_BUFFERING_MS = 1000;
const DIAGNOSTIC_MIN_GAP_MS = 250;
const DIAGNOSTIC_DEDUPE_MS = 30_000;

const listeners = new Set<() => void>();
const snapshots = new Map<string, AudioDebugSnapshot>();
let snapshotRevision = 0;
let cachedHookSnapshot: {
  enabled: boolean;
  snapshots: AudioDebugSnapshot[];
  loadModeOverride: Html5LoadModeOverride;
} | null = null;
let cachedHookSnapshotRevision = -1;

const ACTIVITY_EVENTS = new Set<AudioDebugEventName>([
  "progress",
  "playing",
  "canplay",
  "canplaythrough",
]);
const BUFFER_END_EVENTS = new Set<AudioDebugEventName>([
  "progress",
  "playing",
  "canplay",
  "canplaythrough",
  "error",
]);

function emit(): void {
  snapshotRevision += 1;
  for (const listener of listeners) {
    listener();
  }
}

function createEventCounts(): AudioDebugEventCounts {
  return {
    loadstart: 0,
    loadedmetadata: 0,
    canplay: 0,
    canplaythrough: 0,
    playing: 0,
    waiting: 0,
    stalled: 0,
    suspend: 0,
    progress: 0,
    error: 0,
  };
}

function currentTimeMs(): number {
  return Date.now();
}

function normalizeDebugContextState(
  state: AudioContextState | AudioDebugContextSnapshot["state"]
): AudioDebugContextSnapshot["state"] {
  if (state === "running") {
    return "running";
  }
  if (state === "closed") {
    return "closed";
  }
  return "suspended";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: explicit field defaults keep debug snapshots predictable
function createSnapshot(
  id: string,
  init?: Partial<AudioDebugSnapshot>
): AudioDebugSnapshot {
  const now = currentTimeMs();
  return {
    id,
    mode: init?.mode ?? "unknown",
    stationName: init?.stationName ?? null,
    radioId: init?.radioId ?? null,
    streamUrl: init?.streamUrl ?? null,
    currentSrc: init?.currentSrc ?? null,
    host: init?.host ?? hostFromUrl(init?.streamUrl ?? undefined),
    loadMode: init?.loadMode ?? null,
    deliveryPath: init?.deliveryPath ?? "unknown",
    processingPath: init?.processingPath ?? "html5",
    crossOrigin: init?.crossOrigin ?? null,
    readyState: init?.readyState ?? null,
    networkState: init?.networkState ?? null,
    bufferedAheadSec: init?.bufferedAheadSec ?? null,
    eventCounts: init?.eventCounts ?? createEventCounts(),
    recentEvents: init?.recentEvents ?? [],
    totalBufferingMs: init?.totalBufferingMs ?? 0,
    maxGapMs: init?.maxGapMs ?? 0,
    firstPlayableMs: init?.firstPlayableMs ?? null,
    waitingSinceMs: init?.waitingSinceMs ?? null,
    lastActivityAt: init?.lastActivityAt ?? null,
    lastTelemetryAt: init?.lastTelemetryAt ?? null,
    context: init?.context ?? null,
    usesWorklet: init?.usesWorklet ?? false,
    workletActive: init?.workletActive ?? false,
    workletBypassed: init?.workletBypassed ?? false,
    effectsActive: init?.effectsActive ?? false,
    filterActive: init?.filterActive ?? false,
    createdAt: init?.createdAt ?? now,
    lastUpdatedAt: init?.lastUpdatedAt ?? now,
  };
}

function ensureSnapshot(
  id: string,
  init?: Partial<AudioDebugSnapshot>
): AudioDebugSnapshot {
  const existing = snapshots.get(id);
  if (existing) {
    return existing;
  }
  const snapshot = createSnapshot(id, init);
  snapshots.set(id, snapshot);
  return snapshot;
}

function mergeSnapshot(
  id: string,
  partial: Partial<AudioDebugSnapshot>
): AudioDebugSnapshot {
  const existing = ensureSnapshot(id);
  const merged: AudioDebugSnapshot = {
    ...existing,
    ...partial,
    eventCounts: partial.eventCounts ?? existing.eventCounts,
    recentEvents: partial.recentEvents ?? existing.recentEvents,
    context: partial.context ?? existing.context,
    host:
      partial.host ??
      hostFromUrl(
        partial.currentSrc ??
          partial.streamUrl ??
          existing.currentSrc ??
          existing.streamUrl ??
          undefined
      ),
    lastUpdatedAt: currentTimeMs(),
  };
  snapshots.set(id, merged);
  return merged;
}

function readBufferedAheadSec(
  element?: Pick<HTMLMediaElement, "buffered" | "currentTime"> | null
): number | null {
  if (!element) {
    return null;
  }

  try {
    const { buffered, currentTime } = element;
    for (let i = 0; i < buffered.length; i += 1) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (currentTime >= start && currentTime <= end) {
        return Math.max(0, end - currentTime);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildEventEntry(
  name: AudioDebugEventName,
  element?: Pick<
    HTMLMediaElement,
    "currentTime" | "readyState" | "networkState" | "buffered"
  > | null
): AudioDebugEventEntry {
  return {
    name,
    at: currentTimeMs(),
    readyState: element?.readyState ?? null,
    networkState: element?.networkState ?? null,
    bufferedAheadSec: readBufferedAheadSec(element),
    currentTime: element?.currentTime ?? null,
  };
}

function maybeCaptureDiagnostic(snapshot: AudioDebugSnapshot): void {
  if (snapshot.mode === "unknown") {
    return;
  }

  const bufferingEvents =
    snapshot.eventCounts.waiting +
    snapshot.eventCounts.stalled +
    snapshot.eventCounts.suspend;
  if (bufferingEvents < DIAGNOSTIC_CLUSTER_THRESHOLD) {
    return;
  }

  if (
    snapshot.totalBufferingMs < DIAGNOSTIC_MIN_BUFFERING_MS &&
    snapshot.maxGapMs < DIAGNOSTIC_MIN_GAP_MS
  ) {
    return;
  }

  const now = currentTimeMs();
  if (
    snapshot.lastTelemetryAt !== null &&
    now - snapshot.lastTelemetryAt < DIAGNOSTIC_DEDUPE_MS
  ) {
    return;
  }

  capturePlaybackError(new Error("Playback buffering cluster detected"), {
    mode: snapshot.mode,
    radioName: snapshot.stationName ?? undefined,
    radioId: snapshot.radioId ?? undefined,
    streamUrl: snapshot.currentSrc ?? snapshot.streamUrl ?? undefined,
    streamHost: snapshot.host,
    errorCode: "STREAM_BUFFERING_CLUSTER",
    errorMessage:
      `Buffering cluster detected: waiting=${snapshot.eventCounts.waiting}, ` +
      `stalled=${snapshot.eventCounts.stalled}, suspend=${snapshot.eventCounts.suspend}, ` +
      `totalBufferingMs=${Math.round(snapshot.totalBufferingMs)}, maxGapMs=${Math.round(snapshot.maxGapMs)}`,
    retryPhase: "none",
    tags: {
      load_mode: snapshot.loadMode ?? "unknown",
      delivery_path: snapshot.deliveryPath,
      processing_path: snapshot.processingPath,
      uses_worklet: snapshot.usesWorklet,
      worklet_bypassed: snapshot.workletBypassed,
    },
    context: {
      sampleRate: snapshot.context?.sampleRate ?? null,
      baseLatency: snapshot.context?.baseLatency ?? null,
      outputLatency: snapshot.context?.outputLatency ?? null,
      waitingCount: snapshot.eventCounts.waiting,
      stalledCount: snapshot.eventCounts.stalled,
      suspendCount: snapshot.eventCounts.suspend,
      totalBufferingMs: snapshot.totalBufferingMs,
      maxGapMs: snapshot.maxGapMs,
      firstPlayableMs: snapshot.firstPlayableMs,
    },
  });

  mergeSnapshot(snapshot.id, { lastTelemetryAt: now });
}

export function isAudioDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    new URLSearchParams(window.location.search).get(DEBUG_QUERY_PARAM) === "1"
  );
}

export function registerAudioDebugSource(input: {
  id: string;
  mode: AudioDebugMode;
  radio?: Radio;
  streamUrl?: string;
  loadMode?: Html5LoadMode | null;
  deliveryPath?: AudioDebugDeliveryPath;
  processingPath?: AudioDebugProcessingPath;
  usesWorklet?: boolean;
  workletActive?: boolean;
  workletBypassed?: boolean;
  effectsActive?: boolean;
  filterActive?: boolean;
}): void {
  const snapshot = createSnapshot(input.id, {
    mode: input.mode,
    stationName: input.radio?.name ?? null,
    radioId: input.radio?.id ?? null,
    streamUrl: input.streamUrl ?? input.radio?.streamUrl ?? null,
    loadMode: input.loadMode ?? null,
    deliveryPath: input.deliveryPath ?? "unknown",
    processingPath: input.processingPath ?? "html5",
    usesWorklet: input.usesWorklet ?? false,
    workletActive: input.workletActive ?? false,
    workletBypassed: input.workletBypassed ?? false,
    effectsActive: input.effectsActive ?? false,
    filterActive: input.filterActive ?? false,
  });
  snapshots.set(input.id, snapshot);
  emit();
}

export function updateAudioDebugSnapshot(
  id: string,
  partial: Partial<AudioDebugSnapshot>
): void {
  mergeSnapshot(id, partial);
  emit();
}

export function syncAudioDebugMediaState(
  id: string,
  input: {
    element?: Pick<
      HTMLMediaElement,
      | "currentSrc"
      | "crossOrigin"
      | "readyState"
      | "networkState"
      | "buffered"
      | "currentTime"
    > | null;
    streamUrl?: string | null;
    loadMode?: Html5LoadMode | null;
    deliveryPath?: AudioDebugDeliveryPath;
    processingPath?: AudioDebugProcessingPath;
    usesWorklet?: boolean;
    workletActive?: boolean;
    workletBypassed?: boolean;
    effectsActive?: boolean;
    filterActive?: boolean;
  }
): void {
  const currentSrc = input.element?.currentSrc || null;
  updateAudioDebugSnapshot(id, {
    streamUrl: input.streamUrl ?? undefined,
    currentSrc,
    host: hostFromUrl(currentSrc || input.streamUrl || undefined),
    loadMode: input.loadMode ?? undefined,
    deliveryPath: input.deliveryPath ?? undefined,
    processingPath: input.processingPath ?? undefined,
    crossOrigin: input.element?.crossOrigin ?? null,
    readyState: input.element?.readyState ?? null,
    networkState: input.element?.networkState ?? null,
    bufferedAheadSec: readBufferedAheadSec(input.element),
    usesWorklet: input.usesWorklet ?? undefined,
    workletActive: input.workletActive ?? undefined,
    workletBypassed: input.workletBypassed ?? undefined,
    effectsActive: input.effectsActive ?? undefined,
    filterActive: input.filterActive ?? undefined,
  });
}

export function recordAudioDebugEvent(
  id: string,
  name: AudioDebugEventName,
  input?: {
    element?: Pick<
      HTMLMediaElement,
      | "currentTime"
      | "readyState"
      | "networkState"
      | "buffered"
      | "currentSrc"
      | "crossOrigin"
    > | null;
    streamUrl?: string | null;
    loadMode?: Html5LoadMode | null;
    deliveryPath?: AudioDebugDeliveryPath;
    processingPath?: AudioDebugProcessingPath;
  }
): void {
  const snapshot = ensureSnapshot(id);
  const now = currentTimeMs();
  const nextCounts = {
    ...snapshot.eventCounts,
    [name]: snapshot.eventCounts[name] + 1,
  };
  const eventEntry = buildEventEntry(name, input?.element);
  const recentEvents = [...snapshot.recentEvents, eventEntry].slice(
    -RECENT_EVENT_LIMIT
  );
  const bufferedAheadSec = readBufferedAheadSec(input?.element);

  let totalBufferingMs = snapshot.totalBufferingMs;
  let waitingSinceMs = snapshot.waitingSinceMs;
  if (name === "waiting" || name === "stalled" || name === "suspend") {
    waitingSinceMs ??= now;
  } else if (waitingSinceMs !== null && BUFFER_END_EVENTS.has(name)) {
    totalBufferingMs += now - waitingSinceMs;
    waitingSinceMs = null;
  }

  let firstPlayableMs = snapshot.firstPlayableMs;
  if (name === "playing" && firstPlayableMs === null) {
    firstPlayableMs = Math.max(0, now - snapshot.createdAt);
  }

  let lastActivityAt = snapshot.lastActivityAt;
  let maxGapMs = snapshot.maxGapMs;
  if (ACTIVITY_EVENTS.has(name)) {
    if (lastActivityAt !== null) {
      maxGapMs = Math.max(maxGapMs, now - lastActivityAt);
    }
    lastActivityAt = now;
  }

  const merged = mergeSnapshot(id, {
    streamUrl: input?.streamUrl ?? undefined,
    currentSrc: input?.element?.currentSrc || snapshot.currentSrc,
    host: hostFromUrl(
      input?.element?.currentSrc ||
        input?.streamUrl ||
        snapshot.currentSrc ||
        snapshot.streamUrl ||
        undefined
    ),
    loadMode: input?.loadMode ?? undefined,
    deliveryPath: input?.deliveryPath ?? undefined,
    processingPath: input?.processingPath ?? undefined,
    crossOrigin: input?.element?.crossOrigin ?? snapshot.crossOrigin,
    readyState: input?.element?.readyState ?? snapshot.readyState,
    networkState: input?.element?.networkState ?? snapshot.networkState,
    bufferedAheadSec,
    eventCounts: nextCounts,
    recentEvents,
    totalBufferingMs,
    waitingSinceMs,
    firstPlayableMs,
    lastActivityAt,
    maxGapMs,
  });

  maybeCaptureDiagnostic(merged);
  emit();
}

export function updateAudioDebugContext(
  id: string,
  context: {
    state: AudioContextState | AudioDebugContextSnapshot["state"];
    sampleRate: number | null;
    baseLatency?: number | null;
    outputLatency?: number | null;
  }
): void {
  const contextSnapshot: AudioDebugContextSnapshot = {
    state: normalizeDebugContextState(context.state),
    sampleRate:
      typeof context.sampleRate === "number" &&
      Number.isFinite(context.sampleRate)
        ? context.sampleRate
        : null,
    baseLatency:
      typeof context.baseLatency === "number" ? context.baseLatency : null,
    outputLatency:
      typeof context.outputLatency === "number" ? context.outputLatency : null,
    updatedAt: currentTimeMs(),
  };

  updateAudioDebugSnapshot(id, {
    context: contextSnapshot,
  });
}

export function removeAudioDebugSource(id: string): void {
  if (snapshots.delete(id)) {
    emit();
  }
}

export function clearAudioDebugSources(): void {
  if (snapshots.size === 0) {
    return;
  }
  snapshots.clear();
  emit();
}

export function getAudioDebugSnapshots(): AudioDebugSnapshot[] {
  return Array.from(snapshots.values()).sort(
    (a, b) => b.lastUpdatedAt - a.lastUpdatedAt
  );
}

export function getAudioDebugSnapshot(
  id: string
): AudioDebugSnapshot | undefined {
  return snapshots.get(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getHookSnapshot(): {
  enabled: boolean;
  snapshots: AudioDebugSnapshot[];
  loadModeOverride: Html5LoadModeOverride;
} {
  const enabled = isAudioDebugEnabled();
  const loadModeOverride = getLoadModeOverride();

  if (
    cachedHookSnapshot !== null &&
    cachedHookSnapshotRevision === snapshotRevision &&
    cachedHookSnapshot.enabled === enabled &&
    cachedHookSnapshot.loadModeOverride === loadModeOverride
  ) {
    return cachedHookSnapshot;
  }

  cachedHookSnapshot = {
    enabled,
    snapshots: getAudioDebugSnapshots(),
    loadModeOverride,
  };
  cachedHookSnapshotRevision = snapshotRevision;
  return cachedHookSnapshot;
}

const SERVER_SNAPSHOT: {
  enabled: false;
  snapshots: [];
  loadModeOverride: Html5LoadModeOverride;
} = {
  enabled: false,
  snapshots: [],
  loadModeOverride: "auto" as Html5LoadModeOverride,
};

function getServerSnapshot(): {
  enabled: false;
  snapshots: [];
  loadModeOverride: Html5LoadModeOverride;
} {
  return SERVER_SNAPSHOT;
}

export function useAudioDebug() {
  const state = useSyncExternalStore(
    subscribe,
    getHookSnapshot,
    getServerSnapshot
  );

  return {
    ...state,
    setLoadModeOverride(value: Html5LoadModeOverride) {
      persistLoadModeOverride(value);
      emit();
    },
    clearAudioDebugSources,
  };
}
