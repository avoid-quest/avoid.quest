/**
 * Spectrum Analyzer Display Component
 *
 * Canvas-based frequency spectrum visualization.
 */

import { cn } from "@avoid.quest/ui/lib/utils";
import { memo, useEffect, useRef } from "react";

export type SpectrumDisplayProps = {
  spectrum: Float32Array | null;
  barCount?: number;
  minDb?: number;
  maxDb?: number;
  barGap?: number;
  className?: string;
  colorScheme?: "green" | "blue" | "purple" | "rainbow";
};

// Logarithmic frequency scale mapping
function getLogFrequencyIndex(
  barIndex: number,
  totalBars: number,
  binCount: number
): number {
  // Map bar position to frequency using log scale (20Hz to ~20kHz)
  const minFreq = 20;
  const maxFreq = 20_000;
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);

  const logFreq = logMin + (barIndex / totalBars) * (logMax - logMin);
  const freq = 10 ** logFreq;

  // Map frequency to bin index (assuming 44100Hz sample rate)
  const binIndex = Math.floor((freq / 22_050) * binCount);
  return Math.min(binIndex, binCount - 1);
}

// Average bins in a range for smoother display
function getAverageBinValue(
  spectrum: Float32Array,
  startBin: number,
  endBin: number
): number {
  if (startBin >= endBin || startBin >= spectrum.length) {
    return spectrum[Math.min(startBin, spectrum.length - 1)] ?? -100;
  }

  let sum = 0;
  let count = 0;
  for (let i = startBin; i < Math.min(endBin, spectrum.length); i++) {
    sum += spectrum[i] ?? -100;
    count++;
  }
  return count > 0 ? sum / count : -100;
}

const colorSchemes = {
  green: {
    start: "rgba(34, 197, 94, 0.8)",
    end: "rgba(22, 163, 74, 1)",
  },
  blue: {
    start: "rgba(59, 130, 246, 0.8)",
    end: "rgba(37, 99, 235, 1)",
  },
  purple: {
    start: "rgba(168, 85, 247, 0.8)",
    end: "rgba(147, 51, 234, 1)",
  },
  rainbow: {
    start: "hsl(var(--bar-hue), 70%, 60%)",
    end: "hsl(var(--bar-hue), 70%, 50%)",
  },
};

export const SpectrumDisplay = memo(function SpectrumDisplay({
  spectrum,
  barCount = 32,
  minDb = -60,
  maxDb = 0,
  barGap = 2,
  className,
  colorScheme = "green",
}: SpectrumDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const draw = () => {
      const { width, height } = canvas;
      const dpr = window.devicePixelRatio || 1;
      const scaledWidth = width / dpr;
      const scaledHeight = height / dpr;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      if (!spectrum || spectrum.length === 0) {
        // Draw empty state
        ctx.fillStyle = "rgba(128, 128, 128, 0.2)";
        const barWidth = (scaledWidth - barGap * (barCount - 1)) / barCount;
        for (let i = 0; i < barCount; i++) {
          const x = i * (barWidth + barGap);
          ctx.fillRect(
            x * dpr,
            (scaledHeight - 4) * dpr,
            barWidth * dpr,
            4 * dpr
          );
        }
        return;
      }

      const barWidth = (scaledWidth - barGap * (barCount - 1)) / barCount;
      const dbRange = maxDb - minDb;

      for (let i = 0; i < barCount; i++) {
        // Get bin range for this bar
        const startBin = getLogFrequencyIndex(i, barCount, spectrum.length);
        const endBin = getLogFrequencyIndex(i + 1, barCount, spectrum.length);

        // Get averaged value for this frequency range
        const dbValue = getAverageBinValue(spectrum, startBin, endBin);

        // Normalize to 0-1
        const normalizedValue = Math.max(
          0,
          Math.min(1, (dbValue - minDb) / dbRange)
        );

        const x = i * (barWidth + barGap);
        const barHeight = Math.max(2, normalizedValue * scaledHeight);

        // Create gradient for bar
        const gradient = ctx.createLinearGradient(
          0,
          (scaledHeight - barHeight) * dpr,
          0,
          scaledHeight * dpr
        );

        if (colorScheme === "rainbow") {
          const hue = (i / barCount) * 300; // 0-300 for rainbow effect
          gradient.addColorStop(0, `hsla(${hue}, 70%, 60%, 0.8)`);
          gradient.addColorStop(1, `hsla(${hue}, 70%, 50%, 1)`);
        } else {
          const colors = colorSchemes[colorScheme];
          gradient.addColorStop(0, colors.start);
          gradient.addColorStop(1, colors.end);
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(
          x * dpr,
          (scaledHeight - barHeight) * dpr,
          barWidth * dpr,
          barHeight * dpr
        );
      }
    };

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
    });

    resizeObserver.observe(canvas);
    draw();

    return () => {
      resizeObserver.disconnect();
    };
  }, [spectrum, barCount, minDb, maxDb, barGap, colorScheme]);

  return (
    <canvas
      className={cn("h-16 w-full", className)}
      ref={canvasRef}
      style={{ imageRendering: "pixelated" }}
    />
  );
});
