export type TrackProgress = { position: number; duration: number };
export type TrackProgressState = TrackProgress & { soundId: string | null };

const EMPTY_TRACK_PROGRESS: TrackProgress = { duration: 0, position: 0 };

export function getVisibleTrackProgress(
  soundId: string | null,
  state: TrackProgressState
): TrackProgress {
  return state.soundId === soundId ? state : EMPTY_TRACK_PROGRESS;
}

const refreshListeners = new Map<string, Set<() => void>>();

export function refreshTrackProgress(soundId: string): void {
  for (const listener of refreshListeners.get(soundId) ?? []) {
    listener();
  }
}

export function subscribeTrackProgressRefresh(
  soundId: string,
  listener: () => void
): () => void {
  const listeners = refreshListeners.get(soundId) ?? new Set<() => void>();
  refreshListeners.set(soundId, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      refreshListeners.delete(soundId);
    }
  };
}
