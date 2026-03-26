import { useEffect, useMemo, useRef, useState } from "react";
import { useDeckAnalysis } from "./use-deck-analysis";

const DEFAULT_HISTORY_SIZE = 120;
const DEFAULT_UPDATE_MS = 140;
const DEFAULT_LIVE_WINDOW_SECONDS = 12;

function getEnvelopePeak(waveform: Float32Array | null): number {
  if (!waveform || waveform.length === 0) {
    return 0;
  }

  let peak = 0;
  for (let i = 0; i < waveform.length; i++) {
    peak = Math.max(peak, Math.abs(waveform[i] ?? 0));
  }
  return peak;
}

export function useDeckWaveformHistory(
  soundId: string | null,
  enabled = true,
  options: {
    historySize?: number;
    updateMs?: number;
    liveWindowSeconds?: number;
  } = {}
): {
  samples: number[];
  hasSignal: boolean;
  peak: number;
  secondsPerSample: number;
  liveWindowSeconds: number;
} {
  const {
    historySize = DEFAULT_HISTORY_SIZE,
    updateMs = DEFAULT_UPDATE_MS,
    liveWindowSeconds = DEFAULT_LIVE_WINDOW_SECONDS,
  } = options;

  const analysis = useDeckAnalysis(soundId, enabled);
  const [samples, setSamples] = useState<number[]>(() =>
    Array.from({ length: historySize }, () => 0)
  );
  const lastPushRef = useRef(0);

  useEffect(() => {
    setSamples(Array.from({ length: historySize }, () => 0));
    lastPushRef.current = 0;
  }, [historySize, soundId]);

  const peak = useMemo(
    () => getEnvelopePeak(analysis.waveform),
    [analysis.waveform]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const now = performance.now();
    if (now - lastPushRef.current < updateMs) {
      return;
    }
    lastPushRef.current = now;

    setSamples((prev) => {
      const next = prev.slice(1);
      next.push(peak);
      return next;
    });
  }, [enabled, peak, updateMs]);

  return {
    samples,
    hasSignal: samples.some((value) => value > 0.001),
    peak,
    secondsPerSample: liveWindowSeconds / historySize,
    liveWindowSeconds,
  };
}
