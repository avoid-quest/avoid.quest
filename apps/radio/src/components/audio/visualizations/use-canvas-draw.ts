import { useEffect, useRef } from "react";

type CanvasSize = { width: number; height: number };

/** Keep observers and the bitmap alive while coalescing changing draw inputs. */
export function useCanvasDraw(
  draw: (ctx: CanvasRenderingContext2D, size: CanvasSize) => void
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const scheduleRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!(canvas && ctx)) {
      return;
    }
    let frame: number | null = null;
    let size: CanvasSize = { height: 0, width: 0 };
    const schedule = () => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        if (!(size.width && size.height)) {
          return;
        }
        const dpr = window.devicePixelRatio || 1;
        const width = Math.round(size.width * dpr);
        const height = Math.round(size.height * dpr);
        if (canvas.width !== width) {
          canvas.width = width;
        }
        if (canvas.height !== height) {
          canvas.height = height;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawRef.current(ctx, size);
      });
    };
    scheduleRef.current = schedule;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        size = {
          height: entry.contentRect.height,
          width: entry.contentRect.width,
        };
      }
      schedule();
    });
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
    });
    // DPR can change without a CSS resize when moving between displays.
    let resolution: MediaQueryList;
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`
      );
      resolution.addEventListener("change", watchResolution);
      schedule();
    };
    watchResolution();
    return () => {
      scheduleRef.current = () => undefined;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      themeObserver.disconnect();
      resolution.removeEventListener("change", watchResolution);
    };
  }, []);

  useEffect(() => {
    drawRef.current = draw;
    scheduleRef.current();
  }, [draw]);
  return canvasRef;
}
