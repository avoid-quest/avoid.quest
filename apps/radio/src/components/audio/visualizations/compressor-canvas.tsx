/**
 * Compressor Transfer Curve Canvas
 *
 * Visualizes the compressor input/output transfer function.
 * Shows threshold, ratio, knee, and optional gain reduction meter.
 */

import { cn } from "@avoid.quest/ui/lib/utils";
import { memo, useEffect, useRef } from "react";
import type { CompressorConfig } from "@/lib/audio/dsp/effects/types";
import { computeCompressorCurve } from "@/lib/audio/visualization/compressor-curve";

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
const THRESHOLD_COLOR = "rgba(239, 68, 68, 0.6)";
const GR_METER_COLOR = "rgba(34, 197, 94, 0.8)";

export const CompressorCanvas = memo(function CompressorCanvasComponent({
  config,
  className,
  gainReduction = 0,
  minDb = -60,
  maxDb = 0,
}: CompressorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ height: 0, width: 0 });

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    const { canvas } = ctx;
    // Compression starts where the input, after the device's input gain,
    // reaches the threshold.
    const thresholdDb = config.threshold - (config.inputgain ?? 0);

    const draw = () => {
      const { width: cssWidth, height: cssHeight } = sizeRef.current;
      if (cssWidth === 0 || cssHeight === 0) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = cssWidth;
      const h = cssHeight;
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
      const thresholdX = dbToX(thresholdDb);
      ctx.strokeStyle = THRESHOLD_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(thresholdX, 0);
      ctx.lineTo(thresholdX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw compressor transfer curve. The canvas carries text-foreground,
      // so the curve follows the theme like the EQ curve.
      const foreground = getComputedStyle(canvas).color;
      ctx.strokeStyle = foreground;
      ctx.lineWidth = 2;
      ctx.beginPath();

      const numPoints = Math.floor(w);
      const inputDb = Float32Array.from(
        { length: numPoints + 1 },
        (_, i) => minDb + (i / numPoints) * dbRange
      );
      const outputDb = computeCompressorCurve(config, inputDb);
      for (let i = 0; i <= numPoints; i += 1) {
        const x = dbToX(inputDb[i] ?? minDb);
        const y = dbToY(Math.max(minDb, Math.min(maxDb, outputDb[i] ?? minDb)));

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

        // GR label, in the theme's foreground
        ctx.fillStyle = foreground;
        ctx.font = "10px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${gainReduction.toFixed(1)} dB`, w - grWidth - 8, 14);
      }
    };

    draw();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { height, width };
      }
      draw();
    });
    resizeObserver.observe(canvas);
    // next-themes switches the theme class on <html>; redraw in the new colours.
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [config, gainReduction, minDb, maxDb]);

  return (
    <canvas
      className={cn(
        "h-24 w-full rounded bg-background/50 text-foreground",
        className
      )}
      ref={canvasRef}
    />
  );
});
