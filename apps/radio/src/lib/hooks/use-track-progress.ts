import { useThrottledCallback } from "@tanstack/react-pacer";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioManager } from "@/lib/audio";

/**
 * Track progress hook
 *
 * Polls the AudioManager for current playback position and duration using RAF.
 * Updates are throttled at 250ms intervals to balance accuracy and performance.
 *
 * For live streams, duration will be Infinity.
 * For finite tracks (Bandcamp, SoundCloud), both position and duration are available.
 */
export function useTrackProgress(soundId: string | null): {
  position: number;
  duration: number;
} {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number | null>(null);

  const updateState = useThrottledCallback(
    (pos: number, dur: number) => {
      setPosition(pos);
      setDuration(dur);
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
      updateState(progress.position, progress.duration);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [soundId, updateState]);

  useEffect(() => {
    if (!soundId) {
      setPosition(0);
      setDuration(0);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [soundId, tick]);

  return { position, duration };
}
