import { useEffect, useState } from "react";
import { AudioManager } from "@/lib/audio";

/**
 * Track progress hook
 *
 * Polls the AudioManager for current playback position and duration.
 * Updates at ~4Hz (250ms intervals) to balance accuracy and performance.
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

  useEffect(() => {
    if (!soundId) {
      setPosition(0);
      setDuration(0);
      return;
    }

    const audioManager = AudioManager.getInstance();

    // Poll for progress updates
    const updateProgress = () => {
      const progress = audioManager.getTrackProgress(soundId);
      if (progress) {
        setPosition(progress.position);
        // For live streams, duration is Infinity - we keep it as-is
        // The UI can decide how to display this
        setDuration(progress.duration);
      }
    };

    // Initial update
    updateProgress();

    // Poll at ~4Hz (250ms) for smooth progress updates
    const intervalId = setInterval(updateProgress, 250);

    return () => {
      clearInterval(intervalId);
    };
  }, [soundId]);

  return { position, duration };
}
