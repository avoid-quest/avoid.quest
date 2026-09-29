/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { useRef } from "react";

type KnobProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Double-click and snap target. */
  defaultValue?: number;
  /** Fill the arc from the default value outward instead of from the minimum. */
  bipolar?: boolean;
  /** "log" spaces values geometrically, so a 0.5..2 range puts 1 at the centre. */
  scale?: "linear" | "log";
  label?: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Diameter in px. */
  size?: number;
  className?: string;
  title?: string;
};

const SWEEP = 270;
const DRAG_PIXELS_FOR_FULL_RANGE = 180;
const SNAP_RATIO = 0.02;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const start = polar(cx, cy, r, from);
  const end = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

/**
 * Controlled rotary control. Drag up or down, hold Shift for fine steps,
 * double-click to reset to the default, arrow keys to nudge.
 */
function Knob({
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  bipolar = false,
  scale = "linear",
  label,
  format = (v) => String(Math.round(v * 100) / 100),
  onChange,
  disabled = false,
  size = 40,
  className,
  title,
}: KnobProps) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);
  const range = max - min;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snap = (v: number) => {
    const snapped = Math.round(v / step) * step;
    if (
      defaultValue !== undefined &&
      Math.abs(snapped - defaultValue) < range * SNAP_RATIO
    ) {
      return defaultValue;
    }
    return clamp(snapped);
  };
  const isLog = scale === "log" && min > 0;
  // Position 0..1 along the sweep, and back.
  const toPosition = (v: number) =>
    isLog
      ? Math.log(clamp(v) / min) / Math.log(max / min)
      : (clamp(v) - min) / range;
  const fromPosition = (t: number) =>
    isLog ? min * (max / min) ** t : min + t * range;
  const toAngle = (v: number) => toPosition(v) * SWEEP - SWEEP / 2;
  const origin = bipolar && defaultValue !== undefined ? defaultValue : min;
  const valueAngle = toAngle(value);
  const originAngle = toAngle(origin);
  const c = size / 2;
  const r = c - 3;
  const tip = polar(c, c, r - 4, valueAngle);
  const text = format(value);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    drag.current = { startValue: toPosition(value), startY: event.clientY };
  };
  const handlePointerMove = (event: React.PointerEvent) => {
    const { current } = drag;
    if (current === null) {
      return;
    }
    const fine = event.shiftKey ? 4 : 1;
    const delta =
      (current.startY - event.clientY) / (DRAG_PIXELS_FOR_FULL_RANGE * fine);
    onChange(snap(fromPosition(current.startValue + delta)));
  };
  const handlePointerUp = () => {
    drag.current = null;
  };
  const handleDoubleClick = () => {
    if (!disabled && defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) {
      return;
    }
    const big = event.shiftKey ? range / 10 : step;
    let next: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      next = value + big;
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      next = value - big;
    } else if (event.key === "Home") {
      next = min;
    } else if (event.key === "End") {
      next = max;
    }
    if (next !== null) {
      event.preventDefault();
      onChange(clamp(next));
    }
  };

  return (
    <div
      className={cn(
        "flex w-16 shrink-0 flex-col items-center gap-0.5",
        disabled && "opacity-50",
        className
      )}
      data-slot="knob"
      title={title ?? (label ? `${label}: ${text}` : text)}
    >
      <div
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={value}
        aria-valuetext={text}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:p-1"
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        tabIndex={disabled ? -1 : 0}
      >
        <svg
          aria-hidden="true"
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          width={size}
        >
          <path
            className="stroke-border"
            d={arc(c, c, r, -SWEEP / 2, SWEEP / 2)}
            fill="none"
            strokeLinecap="round"
            strokeWidth={2.5}
          />
          {Math.abs(valueAngle - originAngle) > 0.5 ? (
            <path
              className="stroke-foreground"
              d={arc(c, c, r, originAngle, valueAngle)}
              data-slot={bipolar ? "knob-origin-arc" : "knob-arc"}
              fill="none"
              strokeLinecap="round"
              strokeWidth={2.5}
            />
          ) : null}
          <circle className="fill-muted" cx={c} cy={c} r={r - 6} />
          <line
            className="stroke-foreground"
            strokeLinecap="round"
            strokeWidth={2}
            x1={c}
            x2={tip.x}
            y1={c}
            y2={tip.y}
          />
        </svg>
      </div>
      {label ? (
        <span className="w-full truncate text-center font-mono text-[9px] text-muted-foreground uppercase leading-none tracking-wider">
          {label}
        </span>
      ) : null}
      <span className="font-mono text-[10px] tabular-nums leading-none">
        {text}
      </span>
    </div>
  );
}

export { Knob };
