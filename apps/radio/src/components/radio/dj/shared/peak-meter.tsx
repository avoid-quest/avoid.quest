import { cn } from "@avoid.quest/ui/lib/utils";
import { useEffect, useRef } from "react";

function amplify(level: number) {
  return Math.min(1, Math.max(0, Math.sqrt(level) * 1.2));
}

const COLOR_GREEN = "#34d399";
const COLOR_AMBER = "#fbbf24";
const COLOR_RED = "#ef4444";

const AMBER_AT = 70;
const RED_AT = 90;

// Hard-stop gradient: green up to 70%, amber 70-90%, red 90-100%
const ZONED_V = `linear-gradient(to top, ${COLOR_GREEN} ${AMBER_AT}%, ${COLOR_AMBER} ${AMBER_AT}%, ${COLOR_AMBER} ${RED_AT}%, ${COLOR_RED} ${RED_AT}%)`;
const ZONED_H = `linear-gradient(to right, ${COLOR_GREEN} ${AMBER_AT}%, ${COLOR_AMBER} ${AMBER_AT}%, ${COLOR_AMBER} ${RED_AT}%, ${COLOR_RED} ${RED_AT}%)`;

function getPeakHoldColor(percent: number): string {
  if (percent > RED_AT) {
    return COLOR_RED;
  }
  if (percent > AMBER_AT) {
    return COLOR_AMBER;
  }
  return COLOR_GREEN;
}

// Smoothed level — fast attack, slow release (like analog ballistics)
// When level is exactly 0 (e.g. after eject), snap to 0 immediately
// instead of slowly decaying — otherwise the bar freezes because ref
// mutations don't trigger re-renders.
function useSmoothedLevel(level: number) {
  const smoothedRef = useRef(0);

  if (level === 0) {
    smoothedRef.current = 0;
  }

  useEffect(() => {
    if (level === 0) {
      smoothedRef.current = 0;
      return;
    }
    const target = amplify(level);
    const { current } = smoothedRef;
    if (target >= current) {
      // Attack: jump to 70% immediately, ease the rest
      smoothedRef.current = current + (target - current) * 0.7;
    } else {
      // Release: slow decay
      smoothedRef.current = current + (target - current) * 0.15;
    }
  });

  return smoothedRef.current;
}

function usePeakHold(level: number) {
  const peakRef = useRef(0);
  const decayRef = useRef(0);

  if (level === 0) {
    peakRef.current = 0;
    decayRef.current = 0;
  }

  useEffect(() => {
    if (level === 0) {
      peakRef.current = 0;
      decayRef.current = 0;
      return;
    }
    const amplified = amplify(level);
    if (amplified >= peakRef.current) {
      peakRef.current = amplified;
      decayRef.current = 0;
    } else {
      decayRef.current += 1;
      if (decayRef.current > 12) {
        peakRef.current = Math.max(amplified, peakRef.current - 0.02);
      }
    }
  });

  return peakRef.current;
}

// ─── Single bar ─────────────────────────────────────────────────────────────

function MeterBar({
  level,
  orientation,
  compact = false,
}: {
  level: number;
  orientation: "vertical" | "horizontal";
  compact?: boolean;
}) {
  const smoothed = useSmoothedLevel(level);
  const percent = smoothed * 100;
  const peakHold = usePeakHold(level);
  const peakPercent = peakHold * 100;
  const isVertical = orientation === "vertical";

  const clipPath = isVertical
    ? `inset(${100 - percent}% 0 0 0)`
    : `inset(0 ${100 - percent}% 0 0)`;

  return (
    <div
      className={cn(
        "relative overflow-hidden border border-white/[0.06] bg-white/[0.02]",
        isVertical
          ? "min-h-0 min-w-0 flex-1"
          : `${compact ? "h-1" : "h-1.5"} w-full`
      )}
    >
      <div
        className="absolute inset-0"
        style={{
          background: isVertical ? ZONED_V : ZONED_H,
          clipPath,
          opacity: 0.85,
        }}
      />
      {!compact && peakPercent > 2 && (
        <div
          className="absolute"
          style={
            isVertical
              ? {
                  background: getPeakHoldColor(peakPercent),
                  bottom: `${peakPercent}%`,
                  height: 1,
                  insetInline: 0,
                }
              : {
                  background: getPeakHoldColor(peakPercent),
                  insetBlock: 0,
                  left: `${peakPercent}%`,
                  width: 1,
                }
          }
        />
      )}
      {!compact && percent > RED_AT && (
        <div
          className="absolute rounded-full bg-red-500"
          style={
            isVertical
              ? { height: 3, right: 1, top: 2, width: 3 }
              : { height: 2, right: 2, top: 1, width: 2 }
          }
        />
      )}
    </div>
  );
}

// ─── Stereo pair ────────────────────────────────────────────────────────────

type PeakMeterProps = {
  left: number;
  right: number;
  orientation?: "vertical" | "horizontal";
  className?: string;
  compact?: boolean;
};

function meterLayoutClass(isVertical: boolean, compact: boolean): string {
  if (isVertical) {
    return compact ? "h-full flex-row gap-[1px]" : "h-full flex-row gap-px";
  }
  return compact ? "w-full flex-col gap-px" : "w-full flex-col gap-0.5";
}

export function PeakMeter({
  left,
  right,
  orientation = "vertical",
  className,
  compact = false,
}: PeakMeterProps) {
  const isVertical = orientation === "vertical";

  return (
    <div
      className={cn("flex", meterLayoutClass(isVertical, compact), className)}
    >
      <MeterBar compact={compact} level={left} orientation={orientation} />
      <MeterBar compact={compact} level={right} orientation={orientation} />
    </div>
  );
}

// ─── Deck wrapper ───────────────────────────────────────────────────────────

export function DeckPeakMeter({
  peakLevel,
  className,
}: {
  peakLevel?: { left: number; right: number };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-5 shrink-0 items-stretch px-1 py-2",
        className
      )}
    >
      <PeakMeter
        className="h-full w-full"
        left={peakLevel?.left ?? 0}
        right={peakLevel?.right ?? 0}
      />
    </div>
  );
}
