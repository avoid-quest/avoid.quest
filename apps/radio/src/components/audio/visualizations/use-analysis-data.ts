/**
 * Hook for receiving audio analysis data from the DSP worklet
 */

import { useThrottledCallback } from "@tanstack/react-pacer";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisData } from "../../../lib/audio/dsp/processor.js";

export type AnalysisState = {
  levels: {
    left: number;
    right: number;
    mono: number;
    peak: number;
  };
  spectrum: Float32Array | null;
  waveform: Float32Array | null;
};

const initialState: AnalysisState = {
  levels: { left: 0, right: 0, mono: 0, peak: 0 },
  spectrum: null,
  waveform: null,
};

export type UseAnalysisDataOptions = {
  enabled?: boolean;
  smoothing?: number; // 0-1, how much to smooth level changes
};

/**
 * Hook to receive analysis data from DSP worklet
 * Use the returned ref to set the message handler on your worklet
 */
export function useAnalysisData(options: UseAnalysisDataOptions = {}) {
  const { enabled = true, smoothing = 0.3 } = options;
  const [state, setState] = useState<AnalysisState>(initialState);
  const smoothedLevelsRef = useRef(initialState.levels);

  // Throttle setState to ~30fps to reduce React re-renders
  const throttledSetState = useThrottledCallback(setState, {
    wait: 32,
    leading: true,
    trailing: true,
  });

  const handleAnalysisMessage = useCallback(
    (data: AnalysisData) => {
      // Apply smoothing to levels (always runs for accurate ref tracking)
      const prev = smoothedLevelsRef.current;
      const smoothed = {
        left: prev.left + (data.levels.left - prev.left) * (1 - smoothing),
        right: prev.right + (data.levels.right - prev.right) * (1 - smoothing),
        mono: prev.mono + (data.levels.mono - prev.mono) * (1 - smoothing),
        peak: Math.max(prev.peak * 0.98, data.levels.peak), // Peak hold with decay
      };
      smoothedLevelsRef.current = smoothed;

      // Throttled state update to limit React re-renders
      throttledSetState({
        levels: smoothed,
        spectrum: data.spectrum,
        waveform: data.waveform,
      });
    },
    [smoothing, throttledSetState]
  );

  // Reset state when disabled
  useEffect(() => {
    if (!enabled) {
      setState(initialState);
      smoothedLevelsRef.current = initialState.levels;
    }
  }, [enabled]);

  return {
    state,
    handleAnalysisMessage,
    enabled,
  };
}
