import { useThrottledCallback } from "@tanstack/react-pacer";
import { useEffect, useState } from "react";
import { AudioManager } from "@/lib/audio";

type PeakLevel = { left: number; right: number };

const METER_THROTTLE_MS = 50;

/**
 * Hook to subscribe to the master output meter (post-fader, post-crossfader, post-master volume).
 * Uses real AnalyserNodes tapped from the main output.
 */
export function useMasterPeakLevel(): PeakLevel {
  const [level, setLevel] = useState<PeakLevel>({ left: 0, right: 0 });

  const throttledSetLevel = useThrottledCallback(setLevel, {
    wait: METER_THROTTLE_MS,
    leading: true,
    trailing: true,
  });

  useEffect(() => {
    const audioManager = AudioManager.getInstance();
    const unsubscribe = audioManager.subscribeMasterMeter((l) => {
      throttledSetLevel(l);
    });
    return () => {
      unsubscribe();
      setLevel({ left: 0, right: 0 });
    };
  }, [throttledSetLevel]);

  return level;
}
