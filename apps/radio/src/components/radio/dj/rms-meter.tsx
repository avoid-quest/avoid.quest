import { cn } from "@workspace/ui/lib/utils";

type RmsMeterProps = {
  leftLevel: number;
  rightLevel: number;
  className?: string;
};

/**
 * Vertical stereo RMS meter
 *
 * Displays real-time audio levels for left and right channels.
 * Level values should be 0-1 (linear amplitude).
 */
export function RmsMeter({ leftLevel, rightLevel, className }: RmsMeterProps) {
  // Convert linear to percentage (with some headroom visualization)
  const leftPercent = Math.min(100, Math.max(0, leftLevel * 100));
  const rightPercent = Math.min(100, Math.max(0, rightLevel * 100));

  // Determine color based on level
  const getColor = (level: number) => {
    if (level > 0.9) {
      return "bg-red-500";
    }
    if (level > 0.7) {
      return "bg-amber-500";
    }
    return "bg-emerald-500";
  };

  return (
    <div className={cn("flex gap-0.5", className)}>
      {/* Left channel */}
      <div className="relative h-full w-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          className={cn(
            "absolute right-0 bottom-0 left-0 transition-all duration-75",
            getColor(leftLevel)
          )}
          style={{ height: `${leftPercent}%` }}
        />
      </div>

      {/* Right channel */}
      <div className="relative h-full w-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          className={cn(
            "absolute right-0 bottom-0 left-0 transition-all duration-75",
            getColor(rightLevel)
          )}
          style={{ height: `${rightPercent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Horizontal RMS meter (for compact layouts)
 */
export function HorizontalRmsMeter({
  level,
  className,
}: {
  level: number;
  className?: string;
}) {
  const percent = Math.min(100, Math.max(0, level * 100));

  const getColor = (l: number) => {
    if (l > 0.9) {
      return "bg-red-500";
    }
    if (l > 0.7) {
      return "bg-amber-500";
    }
    return "bg-emerald-500";
  };

  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-sm bg-muted",
        className
      )}
    >
      <div
        className={cn(
          "absolute top-0 bottom-0 left-0 transition-all duration-75",
          getColor(level)
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
