/**
 * Compressor Transfer Curve Canvas
 *
 * Visualizes the compressor input/output transfer function.
 * Shows threshold, ratio, knee, and optional gain reduction meter.
 */

import { cn } from "@avoid.quest/ui/lib/utils";
import { memo, useEffect, useRef } from "react";
import type { CompressorConfig } from "@/lib/audio/dsp/effects/types";

type CompressorCanvasProps = {
  config: CompressorConfig;
  className?: string;
  /** Current gain reduction in dB (for meter) */
  gainReduction?: number;
  /** Min dB for axes */
  minDb?: number;
  /** Max dB for axes */
  maxDb?: number;
};

const GRID_COLOR = "rgba(128, 128, 128, 0.2)";
const UNITY_LINE_COLOR = "rgba(128, 128, 128, 0.4)";
const CURVE_COLOR = "rgba(59, 130, 246, 0.9)";
const THRESHOLD_COLOR = "rgba(239, 68, 68, 0.6)";
const GR_METER_COLOR = "rgba(34, 197, 94, 0.8)";

/**
 * Compute compressor output level for a given input level.
 * Includes soft knee handling.
 */
function computeCompressorOutput(
  inputDb: number,
  threshold: number,
  ratio: number,
  knee: number,
  makeup: number
): number {
  const halfKnee = knee / 2;
  const kneeStart = threshold - halfKnee;
  const kneeEnd = threshold + halfKnee;

  let outputDb: number;

  if (inputDb < kneeStart) {
    // Below knee - no compression
    outputDb = inputDb;
  } else if (inputDb > kneeEnd) {
    // Above knee - full compression
    const excess = inputDb - threshold;
    outputDb = threshold + excess / ratio;
  } else if (knee > 0) {
    // In knee region - soft transition
    const kneeProgress = (inputDb - kneeStart) / knee;
    const compression = 1 + (1 / ratio - 1) * kneeProgress;
    const excess = inputDb - kneeStart;
    outputDb = kneeStart + excess * compression;
  } else {
    // No knee, hard transition
    const excess = inputDb - threshold;
    outputDb = threshold + excess / ratio;
  }

  return outputDb + makeup;
}

export const CompressorCanvas = memo(function CompressorCanvas({
  config,
  className,
  gainReduction = 0,
  minDb = -60,
  maxDb = 0,
}: CompressorCanvasProps) {
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
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width * dpr;
      const height = rect.height * dpr;

      canvas.width = width;
      canvas.height = height;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const dbRange = maxDb - minDb;

      // Helper to convert dB to X coordinate
      const dbToX = (db: number) => ((db - minDb) / dbRange) * w;
      // Helper to convert dB to Y coordinate (inverted: 0dB at top)
      const dbToY = (db: number) => h - ((db - minDb) / dbRange) * h;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Draw grid
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;

      // Vertical and horizontal grid at -48, -36, -24, -12, 0 dB
      const gridLines = [-48, -36, -24, -12, 0].filter(
        (db) => db >= minDb && db <= maxDb
      );
      for (const db of gridLines) {
        // Vertical line (input)
        const x = dbToX(db);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();

        // Horizontal line (output)
        const y = dbToY(db);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Draw unity line (input = output)
      ctx.strokeStyle = UNITY_LINE_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw threshold line
      const thresholdX = dbToX(config.threshold);
      ctx.strokeStyle = THRESHOLD_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(thresholdX, 0);
      ctx.lineTo(thresholdX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw compressor transfer curve
      ctx.strokeStyle = CURVE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();

      const numPoints = Math.floor(w);
      for (let i = 0; i <= numPoints; i++) {
        const inputDb = minDb + (i / numPoints) * dbRange;
        const outputDb = computeCompressorOutput(
          inputDb,
          config.threshold,
          config.ratio,
          config.knee,
          config.makeup
        );

        const x = dbToX(inputDb);
        const y = dbToY(Math.max(minDb, Math.min(maxDb, outputDb)));

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Draw gain reduction meter (if any)
      if (gainReduction < -0.1) {
        const grWidth = 8;
        const grHeight = Math.min(h, (Math.abs(gainReduction) / 24) * h);
        ctx.fillStyle = GR_METER_COLOR;
        ctx.fillRect(w - grWidth - 4, 4, grWidth, grHeight);

        // GR label
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font = "10px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${gainReduction.toFixed(1)} dB`, w - grWidth - 8, 14);
      }
    };

    draw();

    const resizeObserver = new ResizeObserver(() => {
      draw();
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, [config, gainReduction, minDb, maxDb]);

  return (
    <canvas
      className={cn("h-24 w-full rounded bg-background/50", className)}
      ref={canvasRef}
    />
  );
});
