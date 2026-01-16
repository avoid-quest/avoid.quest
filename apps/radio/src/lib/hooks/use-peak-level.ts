import { useEffect, useState } from "react";
import { AudioManager } from "@/lib/audio";

type PeakLevel = { left: number; right: number };

/**
 * Hook to subscribe to peak meter levels for a sound
 *
 * @param soundId - The sound ID to subscribe to
 * @returns The current peak level (left/right channels, 0-1)
 */
export function usePeakLevel(soundId: string | null): PeakLevel {
  const [level, setLevel] = useState<PeakLevel>({ left: 0, right: 0 });

  useEffect(() => {
    if (!soundId) {
      setLevel({ left: 0, right: 0 });
      return;
    }

    const audioManager = AudioManager.getInstance();
    const unsubscribe = audioManager.subscribeMeter(soundId, setLevel);

    return () => {
      unsubscribe();
      setLevel({ left: 0, right: 0 });
    };
  }, [soundId]);

  return level;
}
