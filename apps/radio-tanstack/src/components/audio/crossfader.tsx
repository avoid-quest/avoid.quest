"use client";

import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";

const MAX_POSITION = 100;

export type CrossfaderProps = {
  position: number; // 0 = fully left, 1 = fully right
  onPositionChange: (position: number) => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  showLabels?: boolean;
  leftLabel?: string;
  rightLabel?: string;
  disabled?: boolean;
  defaultValue?: number; // Default position (0 = fully left, 1 = fully right)
};

export function Crossfader({
  position,
  onPositionChange,
  className,
  size = "md",
  showLabels = true,
  leftLabel = "Left",
  rightLabel = "Right",
  disabled = false,
  defaultValue = 0.5, // Default to center (50%)
}: CrossfaderProps) {
  const handleValueChange = (value: number[]) => {
    onPositionChange((value[0] ?? 0) / MAX_POSITION);
  };

  const sizeClasses = {
    sm: "h-2",
    md: "h-3",
    lg: "h-4",
  };

  const thumbSizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showLabels && (
        <div className="flex justify-between text-muted-foreground text-xs">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}

      <div className="relative">
        <Slider
          className={cn(
            sizeClasses[size],
            "[&_.slider-thumb]:rounded-full",
            "[&_.slider-thumb]:border-2",
            "[&_.slider-thumb]:border-primary",
            "[&_.slider-thumb]:bg-background",
            "[&_.slider-thumb]:shadow-lg",
            thumbSizeClasses[size]
          )}
          defaultValue={[defaultValue * MAX_POSITION]}
          disabled={disabled}
          max={MAX_POSITION}
          min={0}
          onValueChange={handleValueChange}
          step={1}
          value={[position * MAX_POSITION]}
        />

        {/* Center indicator */}
        <div className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-1 w-1 rounded-full bg-muted-foreground/50" />
      </div>

      {/* Position indicator */}
      <div className="flex justify-center">
        <span className="text-muted-foreground text-xs">
          {Math.round(position * MAX_POSITION)}%
        </span>
      </div>
    </div>
  );
}
