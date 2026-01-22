/**
 * Waveform Display Component
 *
 * Canvas-based oscilloscope-style waveform visualization.
 */

import { cn } from "@avoid.quest/ui/lib/utils";
import { memo, useEffect, useRef } from "react";

const RGBA_REGEX = /rgba?\(([^)]+)\)/;

export type WaveformDisplayProps = {
  waveform: Float32Array | null;
  lineWidth?: number;
  className?: string;
  color?: string;
  fillOpacity?: number;
};

export const WaveformDisplay = memo(function WaveformDisplay({
  waveform,
  lineWidth = 2,
  className,
  color = "rgba(34, 197, 94, 1)",
  fillOpacity = 0.2,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

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
      const centerY = scaledHeight / 2;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      if (!waveform || waveform.length === 0) {
        // Draw center line for empty state
        ctx.strokeStyle = "rgba(128, 128, 128, 0.3)";
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, centerY * dpr);
        ctx.lineTo(width, centerY * dpr);
        ctx.stroke();
        return;
      }

      const sliceWidth = scaledWidth / waveform.length;

      // Draw filled area
      ctx.fillStyle = color.replace(RGBA_REGEX, `rgba($1, ${fillOpacity})`);
      ctx.beginPath();
      ctx.moveTo(0, centerY * dpr);

      for (let i = 0; i < waveform.length; i++) {
        const x = i * sliceWidth;
        const sample = waveform[i] ?? 0;
        const y = centerY + sample * centerY * 0.9; // 0.9 for some margin
        ctx.lineTo(x * dpr, y * dpr);
      }

      ctx.lineTo(scaledWidth * dpr, centerY * dpr);
      ctx.closePath();
      ctx.fill();

      // Draw waveform line
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth * dpr;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();

      for (let i = 0; i < waveform.length; i++) {
        const x = i * sliceWidth;
        const sample = waveform[i] ?? 0;
        const y = centerY + sample * centerY * 0.9;

        if (i === 0) {
          ctx.moveTo(x * dpr, y * dpr);
        } else {
          ctx.lineTo(x * dpr, y * dpr);
        }
      }

      ctx.stroke();
      animationRef.current = requestAnimationFrame(draw);
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
      cancelAnimationFrame(animationRef.current);
    };
  }, [waveform, lineWidth, color, fillOpacity]);

  return (
    <canvas
      className={cn("h-16 w-full", className)}
      ref={canvasRef}
      style={{ imageRendering: "auto" }}
    />
  );
});
