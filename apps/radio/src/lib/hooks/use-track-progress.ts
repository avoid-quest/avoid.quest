import { useThrottledCallback } from "@tanstack/react-pacer";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioManager } from "@/lib/audio";
import {
  getVisibleTrackProgress,
  type TrackProgress,
  type TrackProgressState,
} from "./track-progress-state";

/**
 * Track progress hook
 *
 * Polls the AudioManager for current playback position and duration using RAF.
 * Updates are throttled at 250ms intervals to balance accuracy and performance.
 *
 * For live streams, duration will be Infinity.
 * For finite tracks (Bandcamp, SoundCloud), both position and duration are available.
 */
export function useTrackProgress(soundId: string | null): TrackProgress {
  const activeSoundIdRef = useRef(soundId);
  activeSoundIdRef.current = soundId;
  const [progress, setProgress] = useState<TrackProgressState>({
    soundId,
    position: 0,
    duration: 0,
  });
  const rafRef = useRef<number | null>(null);

  const updateState = useThrottledCallback(
    (sourceId: string, position: number, duration: number) => {
      if (sourceId === activeSoundIdRef.current) {
        setProgress({ duration, position, soundId: sourceId });
      }
    },
    { wait: 250, leading: true, trailing: true }
  );

  const tick = useCallback(() => {
    if (!soundId) {
      return;
    }
    const audioManager = AudioManager.getInstance();
    const progress = audioManager.getTrackProgress(soundId);
    if (progress) {
      updateState(soundId, progress.position, progress.duration);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [soundId, updateState]);

  useEffect(() => {
    setProgress({ duration: 0, position: 0, soundId });
    if (!soundId) {
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [soundId, tick]);

  return getVisibleTrackProgress(soundId, progress);
}
