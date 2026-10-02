/**
 * EQ Frequency Response Canvas
 *
 * Visualizes the 7-band EQ frequency response curve.
 */

import { cn } from "@avoid.quest/ui/lib/utils";
import { memo, useEffect, useMemo, useRef } from "react";
import type { RevampConfig } from "@/lib/audio/dsp/effects/types";
import {
  computeEQCurve,
  type EQCurveResult,
} from "@/lib/audio/visualization/eq-curve";
import {
  generateLogFrequencies,
  LinearScale,
  LogScale,
} from "@/lib/audio/visualization/scale";

type EQCanvasProps = {
  config: RevampConfig;
  className?: string;
  /** Sample rate for frequency response calculation */
  sampleRate?: number;
  /** Min dB for Y axis */
  minDb?: number;
  /** Max dB for Y axis */
  maxDb?: number;
};

const MIN_FREQ = 20;
const MAX_FREQ = 20_000;
const NUM_POINTS = 512;

// Grid line frequencies (in Hz)
const FREQ_GRID_LINES = [100, 1000, 10_000];
// Grid line gains (in dB)
const DB_GRID_LINES = [-24, -12, 0, 12, 24];

// Band colors
const BAND_COLORS = {
  highBell: "rgba(59, 130, 246, 0.4)",
  highPass: "rgba(239, 68, 68, 0.4)",
  highShelf: "rgba(139, 92, 246, 0.4)",
  lowBell: "rgba(234, 179, 8, 0.4)",
  lowPass: "rgba(236, 72, 153, 0.4)",
  lowShelf: "rgba(249, 115, 22, 0.4)",
  midBell: "rgba(34, 197, 94, 0.4)",
};

const GRID_COLOR = "rgba(128, 128, 128, 0.2)";
const ZERO_LINE_COLOR = "rgba(128, 128, 128, 0.4)";

type DrawContext = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  xScale: LogScale;
  yScale: LinearScale;
  frequencies: Float32Array;
  minDb: number;
  maxDb: number;
};

type CanvasSize = {
  width: number;
  height: number;
};

function drawGrid(dc: DrawContext): void {
  const { ctx, w, h, xScale, yScale } = dc;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;

  for (const freq of FREQ_GRID_LINES) {
    const x = xScale.scale(freq);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (const db of DB_GRID_LINES) {
    const y = yScale.scale(db);
    ctx.strokeStyle = db === 0 ? ZERO_LINE_COLOR : GRID_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawFilledCurve(
  dc: DrawContext,
  dbResponse: Float32Array,
  color: string
): void {
  const { ctx, w, xScale, yScale, frequencies, minDb, maxDb } = dc;
  const zeroY = yScale.scale(0);

  ctx.beginPath();
  for (let i = 0; i < NUM_POINTS; i += 1) {
    const freq = frequencies[i];
    if (freq === undefined) {
      continue;
    }
    const db = dbResponse[i] ?? 0;
    const x = xScale.scale(freq);
    const y = yScale.scale(Math.max(minDb, Math.min(maxDb, db)));

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.lineTo(w, zeroY);
  ctx.lineTo(0, zeroY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawStrokeCurve(
  dc: DrawContext,
  dbResponse: Float32Array,
  color: string
): void {
  const { ctx, xScale, yScale, frequencies, minDb, maxDb } = dc;

  ctx.beginPath();
  for (let i = 0; i < NUM_POINTS; i += 1) {
    const freq = frequencies[i];
    if (freq === undefined) {
      continue;
    }
    const db = dbResponse[i] ?? 0;
    const x = xScale.scale(freq);
    const y = yScale.scale(Math.max(minDb, Math.min(maxDb, db)));

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBandCurves(dc: DrawContext, bands: EQCurveResult["bands"]): void {
  if (bands.highPass.enabled) {
    drawFilledCurve(dc, bands.highPass.dbResponse, BAND_COLORS.highPass);
  }
  if (bands.lowShelf.enabled) {
    drawFilledCurve(dc, bands.lowShelf.dbResponse, BAND_COLORS.lowShelf);
  }
  if (bands.lowBell.enabled) {
    drawFilledCurve(dc, bands.lowBell.dbResponse, BAND_COLORS.lowBell);
  }
  if (bands.midBell.enabled) {
    drawFilledCurve(dc, bands.midBell.dbResponse, BAND_COLORS.midBell);
  }
  if (bands.highBell.enabled) {
    drawFilledCurve(dc, bands.highBell.dbResponse, BAND_COLORS.highBell);
  }
  if (bands.highShelf.enabled) {
    drawFilledCurve(dc, bands.highShelf.dbResponse, BAND_COLORS.highShelf);
  }
  if (bands.lowPass.enabled) {
    drawFilledCurve(dc, bands.lowPass.dbResponse, BAND_COLORS.lowPass);
  }
}

export const EQCanvas = memo(function EQCanvasComponent({
  config,
  className,
  sampleRate = 48_000,
  minDb = -36,
  maxDb = 36,
}: EQCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<CanvasSize>({ height: 0, width: 0 });

  const frequencies = useMemo(
    () => generateLogFrequencies(MIN_FREQ, MAX_FREQ, NUM_POINTS),
    []
  );

  const curveResult = useMemo(
    () => computeEQCurve(config, frequencies, sampleRate),
    [config, frequencies, sampleRate]
  );

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    const { canvas } = ctx;

    const draw = () => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = width;
      const h = height;

      ctx.clearRect(0, 0, w, h);

      const xScale = new LogScale(MIN_FREQ, MAX_FREQ, 0, w);
      const yScale = new LinearScale(maxDb, minDb, 0, h);

      const dc: DrawContext = {
        ctx,
        frequencies,
        h,
        maxDb,
        minDb,
        w,
        xScale,
        yScale,
      };

      drawGrid(dc);
      drawBandCurves(dc, curveResult.bands);
      // The canvas carries text-foreground, so the curve follows the theme.
      drawStrokeCurve(dc, curveResult.totalDb, getComputedStyle(canvas).color);
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
  }, [curveResult, frequencies, minDb, maxDb]);

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
