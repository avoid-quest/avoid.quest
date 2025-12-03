import { useEffect, useRef, useState } from "react";
import { getAudioManager } from "@/lib/stores/dj-store/audio-manager-helpers";

export function useTrackProgress(soundId: string | null) {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!soundId) {
      setPosition(0);
      setDuration(0);
      return;
    }

    const updateProgress = () => {
      try {
        const playback = getAudioManager().getPlayback(soundId);
        if (playback) {
          const sound = getAudioManager().getSound(soundId);
          const currentDuration = sound?.duration || 0;
          const currentPos = playback.currentTime || 0;

          setPosition(currentPos);
          setDuration(currentDuration);
        }
      } catch {
        // Ignore errors during polling
      }

      rafId.current = requestAnimationFrame(updateProgress);
    };

    updateProgress();

    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [soundId]);

  return { position, duration };
}
