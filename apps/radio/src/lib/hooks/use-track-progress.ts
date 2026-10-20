import { useEffect, useRef, useState } from "react";
import { AudioManager } from "@/lib/audio";
import {
  getVisibleTrackProgress,
  subscribeTrackProgressRefresh,
  type TrackProgress,
  type TrackProgressState,
} from "./track-progress-state";

/** Samples only the visible, running transport; paused seeks refresh explicitly. */
export function useTrackProgress(
  soundId: string | null,
  isPlaying = true,
  visible = true,
  ready = true
): TrackProgress {
  const [progress, setProgress] = useState<TrackProgressState>({
    duration: 0,
    position: 0,
    soundId,
  });

  const lastProgress = useRef<TrackProgressState | null>(null);

  useEffect(() => {
    if (!(soundId && ready)) {
      return;
    }
    let frame: number | null = null;
    let lastSample = 0;
    const sample = () => {
      const next = AudioManager.getInstance().getTrackProgress(soundId);
      const { current } = lastProgress;
      if (
        next &&
        !(
          current?.soundId === soundId &&
          current.position === next.position &&
          current.duration === next.duration
        )
      ) {
        const sampled = { ...next, soundId };
        lastProgress.current = sampled;
        setProgress(sampled);
      }
    };
    const tick = (now: number) => {
      if (now - lastSample >= 250) {
        sample();
        lastSample = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const updateVisibility = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (visible && !document.hidden) {
        sample();
        if (isPlaying) {
          frame = requestAnimationFrame(tick);
        }
      }
    };
    const unsubscribe = subscribeTrackProgressRefresh(soundId, () => {
      if (visible && !document.hidden) {
        sample();
      }
    });
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", updateVisibility);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [soundId, isPlaying, visible, ready]);

  return getVisibleTrackProgress(soundId, progress);
}
