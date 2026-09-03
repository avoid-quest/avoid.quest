export type TrackProgress = { position: number; duration: number };
export type TrackProgressState = TrackProgress & { soundId: string | null };

const EMPTY_TRACK_PROGRESS: TrackProgress = { duration: 0, position: 0 };

export function getVisibleTrackProgress(
  soundId: string | null,
  state: TrackProgressState
): TrackProgress {
  return state.soundId === soundId ? state : EMPTY_TRACK_PROGRESS;
}
