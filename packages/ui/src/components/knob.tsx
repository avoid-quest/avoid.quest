/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { useControlReset } from "@avoid.quest/ui/hooks/use-control-reset";
import { useFineWheel } from "@avoid.quest/ui/hooks/use-fine-wheel";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useRef } from "react";

type KnobProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Whole-value wheel steps for discrete parameters; continuous parameters use 0.01. */
  wheelStep?: number;
  /** Reset gesture and snap target. */
  defaultValue?: number;
  /** Fill the arc from the default value outward instead of from the minimum. */
  bipolar?: boolean;
  /** "log" spaces values geometrically, so a 0.5..2 range puts 1 at the centre. */
  scale?: "linear" | "log";
  label?: string;
  /** Accessible name when the visible caption is too terse ("FILT"). */
  ariaLabel?: string;
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
 * double-click, double-tap or Ctrl-click to reset, arrow keys to nudge, wheel for 0.01 steps.
 */
function Knob({
  value,
  min,
  max,
  step = 0.01,
  wheelStep,
  defaultValue,
  bipolar = false,
  scale = "linear",
  label,
  ariaLabel,
  format = (v) => String(Math.round(v * 100) / 100),
  onChange,
  disabled = false,
  size = 40,
  className,
  title,
}: KnobProps) {
  const { changeValues, elementRef, getRequestedValues, inputValues } =
    useFineWheel<HTMLDivElement>({
      disabled,
      max,
      min,
      onChange: ([next]) => onChange(next ?? min),
      values: [value],
      wheelStep,
    });
  const changeValue = (next: number) => changeValues([next]);
  const inputValue = inputValues[0] ?? value;
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startValue: number;
  } | null>(null);
  const range = max - min;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const isLog = scale === "log" && min > 0;
  // Position 0..1 along the sweep, and back.
  const toPosition = (v: number) =>
    isLog
      ? Math.log(clamp(v) / min) / Math.log(max / min)
      : (clamp(v) - min) / range;
  const fromPosition = (t: number) =>
    isLog ? min * (max / min) ** t : min + t * range;
  // The snap zone is a slice of the sweep, so a log knob's stays as narrow
  // as a linear one's instead of swallowing the bottom decades.
  const snap = (v: number) => {
    const snapped = Number((Math.round(v / step) * step).toPrecision(12));
    if (
      defaultValue !== undefined &&
      Math.abs(toPosition(snapped) - toPosition(defaultValue)) < SNAP_RATIO
    ) {
      return defaultValue;
    }
    return clamp(snapped);
  };
  const toAngle = (v: number) => toPosition(v) * SWEEP - SWEEP / 2;
  const origin = bipolar && defaultValue !== undefined ? defaultValue : min;
  const valueAngle = toAngle(inputValue);
  const originAngle = toAngle(origin);
  const c = size / 2;
  const r = c - 3;
  const tip = polar(c, c, r - 4, valueAngle);
  const text = format(inputValue);
  const reset = useControlReset(
    disabled || defaultValue === undefined
      ? undefined
      : () => changeValue(clamp(defaultValue))
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    reset.onPointerDown(event);
    if (
      disabled ||
      drag.current !== null ||
      event.defaultPrevented ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    drag.current = {
      pointerId: event.pointerId,
      startValue: toPosition(getRequestedValues()[0] ?? value),
      startY: event.clientY,
    };
  };
  const handlePointerMove = (event: React.PointerEvent) => {
    reset.onPointerMove(event);
    const { current } = drag;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const fine = event.shiftKey ? 4 : 1;
    const delta =
      (current.startY - event.clientY) / (DRAG_PIXELS_FOR_FULL_RANGE * fine);
    changeValue(snap(fromPosition(current.startValue + delta)));
  };
  const handlePointerEnd = (event: React.PointerEvent) => {
    if (event.type === "pointerup") {
      reset.onPointerUp(event);
    } else {
      reset.onPointerCancel(event);
    }
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) {
      return;
    }
    const current = getRequestedValues()[0] ?? value;
    const big = event.shiftKey ? range / 10 : step;
    let next: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      next = current + big;
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      next = current - big;
    } else if (event.key === "Home") {
      next = min;
    } else if (event.key === "End") {
      next = max;
    }
    if (next !== null) {
      event.preventDefault();
      changeValue(clamp(Number(next.toPrecision(12))));
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
        aria-label={ariaLabel ?? label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={inputValue}
        aria-valuetext={text}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:p-1"
        onContextMenu={reset.onContextMenu}
        onDoubleClick={reset.onDoubleClick}
        onKeyDown={handleKeyDown}
        onLostPointerCapture={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        ref={elementRef}
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
