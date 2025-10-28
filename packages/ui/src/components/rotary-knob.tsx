"use client";

import { cn } from "@workspace/ui/lib/utils";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type RotaryKnobProps = {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  size?: number;
  onChange?: (value: number) => void;
  label?: string;
  showValue?: boolean;
  className?: string;
  orientation?: "vertical" | "horizontal";
};

const MAX_ANGLE = 270;
const MIN_ANGLE = 135;

export function RotaryKnob({
  value = 50,
  min = 0,
  max = 100,
  step = 1,
  size = 120,
  onChange,
  label,
  showValue = true,
  className,
  orientation = "vertical",
}: RotaryKnobProps) {
  const [currentValue, setCurrentValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const knobRef = useRef<HTMLDivElement>(null);
  const startPositionRef = useRef(0);
  const startValueRef = useRef(0);

  // Convert value to angle (270 degrees of rotation, -135 to +135)
  const valueToAngle = (val: number) => {
    const percentage = (val - min) / (max - min);
    return percentage * MAX_ANGLE - MIN_ANGLE;
  };

  const angle = valueToAngle(currentValue);

  const dragToValue = useCallback(
    (currentPos: number) => {
      const dragDistance = startPositionRef.current - currentPos;
      const sensitivity = 200;
      const valueRange = max - min;
      const valueChange = (dragDistance / sensitivity) * valueRange;

      let newValue = startValueRef.current + valueChange;

      newValue = Math.round(newValue / step) * step;

      return Math.max(min, Math.min(max, newValue));
    },
    [min, max, step]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPositionRef.current =
        orientation === "vertical" ? e.clientY : e.clientX;
      startValueRef.current = currentValue;
    },
    [currentValue, orientation]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const touch = e.touches[0];
      startPositionRef.current =
        orientation === "vertical"
          ? (touch?.clientY ?? 0)
          : (touch?.clientX ?? 0);
      startValueRef.current = currentValue;
    },
    [currentValue, orientation]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const currentPos = orientation === "vertical" ? e.clientY : e.clientX;
      const newValue = dragToValue(currentPos);

      setCurrentValue(newValue);
      onChange?.(newValue);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) {
        return;
      }

      const touch = e.touches[0];
      const currentPos =
        orientation === "vertical"
          ? (touch?.clientY ?? 0)
          : (touch?.clientX ?? 0);
      const newValue = dragToValue(currentPos);

      setCurrentValue(newValue);
      onChange?.(newValue);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleEnd);
      document.addEventListener("touchmove", handleTouchMove);
      document.addEventListener("touchend", handleEnd);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, dragToValue, onChange, orientation]);

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      {label && (
        // biome-ignore lint/a11y/noLabelWithoutControl: just a label
        <label className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          {label}
        </label>
      )}
      {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: just a knob */}
      {/** biome-ignore lint/a11y/noStaticElementInteractions: just a knob */}
      <div
        className="relative cursor-grab select-none active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        ref={knobRef}
        style={{ width: size, height: size }}
      >
        <div className="absolute inset-0 rounded-full border border-border bg-background shadow-sm" />

        <div className="absolute inset-[6%] rounded-full bg-muted/50" />

        <div
          className="absolute inset-0 flex items-start justify-center"
          style={{
            transform: `rotate(${angle}deg)`,
          }}
        >
          <div
            className="mt-[8%] h-2 w-2 rounded-full bg-primary shadow-sm"
            style={{
              boxShadow: "0 0 8px hsl(var(--primary) / 0.5)",
            }}
          />
        </div>

        <div className="absolute inset-[30%] rounded-full border border-border/50 bg-background shadow-sm" />
      </div>
      {showValue && (
        <div className="font-medium font-mono text-foreground text-sm tabular-nums">
          {currentValue.toFixed(step < 1 ? 1 : 0)}
        </div>
      )}
    </div>
  );
}
