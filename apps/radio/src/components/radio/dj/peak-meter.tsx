import { cn } from "@workspace/ui/lib/utils";

type PeakMeterProps = {
  leftLevel: number;
  rightLevel: number;
  className?: string;
};

/**
 * Vertical stereo peak meter
 *
 * Displays real-time audio peak levels for left and right channels.
 * Level values should be 0-1 (linear amplitude).
 */
export function PeakMeter({
  leftLevel,
  rightLevel,
  className,
}: PeakMeterProps) {
  // Amplify signal for better visibility (peaks are often low in normalized audio)
  // Using sqrt for perceptually linear response
  const amplify = (level: number) => Math.sqrt(level) * 1.5;

  const leftPercent = Math.min(100, Math.max(0, amplify(leftLevel) * 100));
  const rightPercent = Math.min(100, Math.max(0, amplify(rightLevel) * 100));

  const getColor = (level: number) => {
    const amplified = amplify(level);
    if (amplified > 0.9) {
      return "bg-red-500";
    }
    if (amplified > 0.7) {
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
 * Horizontal peak meter (for compact layouts)
 */
export function HorizontalPeakMeter({
  level,
  className,
}: {
  level: number;
  className?: string;
}) {
  const amplify = (l: number) => Math.sqrt(l) * 1.5;
  const percent = Math.min(100, Math.max(0, amplify(level) * 100));

  const getColor = (l: number) => {
    const amplified = amplify(l);
    if (amplified > 0.9) {
      return "bg-red-500";
    }
    if (amplified > 0.7) {
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
