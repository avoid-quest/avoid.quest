import { useThrottler } from "@tanstack/react-pacer";
import { useEffect, useState } from "react";
import { AudioManager } from "@/lib/audio";

type PeakLevel = { left: number; right: number };

// Throttle to ~20fps for peak meter updates (reduces CPU during playback)
const METER_THROTTLE_MS = 50;

/**
 * Hook to subscribe to peak meter levels for a sound
 *
 * @param soundId - The sound ID to subscribe to
 * @returns The current peak level (left/right channels, 0-1)
 */
export function usePeakLevel(soundId: string | null): PeakLevel {
  const [level, setLevel] = useState<PeakLevel>({ left: 0, right: 0 });

  const throttler = useThrottler(setLevel, {
    wait: METER_THROTTLE_MS,
    leading: true,
    trailing: true,
  });

  useEffect(() => {
    if (!soundId) {
      setLevel({ left: 0, right: 0 });
      return;
    }

    const audioManager = AudioManager.getInstance();
    const unsubscribe = audioManager.subscribeMeter(soundId, (l) => {
      throttler.maybeExecute(l);
    });

    return () => {
      unsubscribe();
      throttler.cancel();
      setLevel({ left: 0, right: 0 });
    };
  }, [soundId, throttler]);

  return level;
}
