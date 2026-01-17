/**
 * VU Level Meter Component
 *
 * Displays stereo audio levels with optional peak indicators.
 */

import { cn } from "@workspace/ui/lib/utils";
import { memo } from "react";

export type LevelMeterProps = {
  leftLevel: number;
  rightLevel: number;
  peakLevel?: number;
  showPeak?: boolean;
  orientation?: "horizontal" | "vertical";
  size?: "sm" | "md" | "lg";
  className?: string;
};

// dB thresholds for color zones
const YELLOW_THRESHOLD = 0.5; // -6dB
const RED_THRESHOLD = 0.9; // -1dB

function LevelBar({
  level,
  peak,
  showPeak,
  orientation,
  size,
}: {
  level: number;
  peak?: number;
  showPeak?: boolean;
  orientation: "horizontal" | "vertical";
  size: "sm" | "md" | "lg";
}) {
  const clampedLevel = Math.max(0, Math.min(1, level));
  const clampedPeak = Math.max(0, Math.min(1, peak ?? 0));

  const sizeClasses = {
    sm: orientation === "vertical" ? "w-2" : "h-2",
    md: orientation === "vertical" ? "w-3" : "h-3",
    lg: orientation === "vertical" ? "w-4" : "h-4",
  };

  // Calculate color based on level
  const getGradientStyle = () => {
    if (orientation === "vertical") {
      return {
        background: `linear-gradient(to top,
          #22c55e 0%,
          #22c55e ${YELLOW_THRESHOLD * 100}%,
          #eab308 ${YELLOW_THRESHOLD * 100}%,
          #eab308 ${RED_THRESHOLD * 100}%,
          #ef4444 ${RED_THRESHOLD * 100}%,
          #ef4444 100%)`,
      };
    }
    return {
      background: `linear-gradient(to right,
        #22c55e 0%,
        #22c55e ${YELLOW_THRESHOLD * 100}%,
        #eab308 ${YELLOW_THRESHOLD * 100}%,
        #eab308 ${RED_THRESHOLD * 100}%,
        #ef4444 ${RED_THRESHOLD * 100}%,
        #ef4444 100%)`,
    };
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm bg-muted",
        sizeClasses[size],
        orientation === "vertical" ? "h-full" : "w-full"
      )}
    >
      {/* Background gradient */}
      <div className="absolute inset-0 opacity-30" style={getGradientStyle()} />

      {/* Level fill */}
      <div
        className="absolute transition-all duration-75"
        style={{
          ...getGradientStyle(),
          ...(orientation === "vertical"
            ? {
                bottom: 0,
                left: 0,
                right: 0,
                height: `${clampedLevel * 100}%`,
              }
            : {
                top: 0,
                bottom: 0,
                left: 0,
                width: `${clampedLevel * 100}%`,
              }),
        }}
      />

      {/* Peak indicator */}
      {showPeak && clampedPeak > 0 && (
        <div
          className="absolute bg-white/80 transition-all duration-150"
          style={
            orientation === "vertical"
              ? {
                  bottom: `${clampedPeak * 100}%`,
                  left: 0,
                  right: 0,
                  height: "2px",
                  transform: "translateY(50%)",
                }
              : {
                  left: `${clampedPeak * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: "2px",
                  transform: "translateX(-50%)",
                }
          }
        />
      )}
    </div>
  );
}

export const LevelMeterDisplay = memo(function LevelMeterDisplay({
  leftLevel,
  rightLevel,
  peakLevel,
  showPeak = true,
  orientation = "vertical",
  size = "md",
  className,
}: LevelMeterProps) {
  const containerClasses =
    orientation === "vertical"
      ? "flex gap-1 h-24"
      : "flex flex-col gap-1 w-full";

  return (
    <div className={cn(containerClasses, className)}>
      <LevelBar
        level={leftLevel}
        orientation={orientation}
        peak={showPeak ? peakLevel : undefined}
        showPeak={showPeak}
        size={size}
      />
      <LevelBar
        level={rightLevel}
        orientation={orientation}
        peak={showPeak ? peakLevel : undefined}
        showPeak={showPeak}
        size={size}
      />
    </div>
  );
});
