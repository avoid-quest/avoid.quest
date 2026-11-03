import { cn } from "@avoid.quest/ui/lib/utils";
import { useEffect, useRef } from "react";
import type { PeakLevelSource } from "@/lib/stores/playback-runtime-store";

const AMBER_AT = 0.7;
const RED_AT = 0.9;
const FRAME_MS = 1000 / 60;
const PEAK_HOLD_MS = 12 * FRAME_MS;
const PEAK_DECAY_PER_MS = 0.02 / FRAME_MS;
const SAMPLE_TIMEOUT_MS = 100;

function amplify(level: number) {
  return Number.isFinite(level)
    ? Math.min(1, Math.sqrt(Math.max(0, level)) * 1.2)
    : 0;
}

type MeterChannel = {
  holdUntil: number;
  level: number;
  peak: number;
  target: number;
};

type MeterElements = {
  fill: HTMLElement | undefined;
  gradient: HTMLElement | undefined;
  peak: HTMLElement | undefined;
  line: HTMLElement | undefined;
  clip: HTMLElement | undefined;
};

function peakState(peak: number): string {
  if (peak > RED_AT) {
    return "destructive";
  }
  if (peak > AMBER_AT) {
    return "warning";
  }
  return "success";
}

function paintChannel(
  channel: MeterChannel,
  elements: MeterElements,
  isVertical: boolean
) {
  const { fill, gradient, peak, line, clip } = elements;
  if (fill) {
    fill.style.transform = `${isVertical ? "scaleY" : "scaleX"}(${channel.level})`;
  }
  if (gradient) {
    gradient.style.transform = `${isVertical ? "scaleY" : "scaleX"}(${channel.level > 0 ? 1 / channel.level : 1})`;
  }
  if (peak) {
    peak.style.transform = isVertical
      ? `translateY(${-channel.peak * 100}%)`
      : `translateX(${channel.peak * 100}%)`;
    peak.style.opacity = channel.peak > 0.02 ? "1" : "0";
  }
  if (line) {
    line.dataset.state = peakState(channel.peak);
  }
  if (clip) {
    clip.style.opacity = channel.level > RED_AT ? "1" : "0";
  }
}

function animateChannel(
  channel: MeterChannel,
  now: number,
  elapsed: number,
  sampledAt: number
): boolean {
  const target = now - sampledAt <= SAMPLE_TIMEOUT_MS ? channel.target : 0;
  const factor =
    1 - (target >= channel.level ? 0.3 : 0.85) ** (elapsed / FRAME_MS);
  channel.level += (target - channel.level) * factor;
  if (channel.level < 0.001) {
    channel.level = 0;
  }
  if (target > 0 && target >= channel.peak) {
    channel.peak = target;
    channel.holdUntil = now + PEAK_HOLD_MS;
  } else if (now > channel.holdUntil) {
    const decayTime = Math.min(elapsed, now - channel.holdUntil);
    channel.peak = Math.max(
      target,
      channel.peak - PEAK_DECAY_PER_MS * decayTime
    );
  }
  return target > 0 || channel.level > 0 || channel.peak > 0;
}

function MeterBar({
  orientation,
  compact,
}: {
  orientation: "vertical" | "horizontal";
  compact: boolean;
}) {
  const isVertical = orientation === "vertical";
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-muted",
        isVertical
          ? "h-full min-h-0 min-w-0 flex-1"
          : `${compact ? "h-1" : "h-1.5"} w-full`
      )}
    >
      <div
        className="absolute inset-0 overflow-hidden"
        data-meter-fill=""
        style={{
          opacity: 0.85,
          transform: isVertical ? "scaleY(0)" : "scaleX(0)",
          transformOrigin: isVertical ? "bottom" : "left",
        }}
      >
        <div
          className={cn(
            "absolute inset-0 from-70% from-success via-[percentage:70%_90%] via-warning to-90% to-destructive",
            isVertical ? "bg-linear-to-t" : "bg-linear-to-r"
          )}
          data-meter-gradient=""
          style={{
            transformOrigin: isVertical ? "bottom" : "left",
          }}
        />
      </div>
      {!compact && (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            data-meter-peak=""
            style={{ opacity: 0 }}
          >
            <div
              className={cn(
                "absolute bg-success data-[state=destructive]:bg-destructive data-[state=warning]:bg-warning",
                isVertical ? "inset-x-0 bottom-0 h-px" : "inset-y-0 left-0 w-px"
              )}
              data-meter-peak-line=""
            />
          </div>
          <div
            className="absolute rounded-full bg-destructive"
            data-meter-clip=""
            style={
              isVertical
                ? { height: 3, opacity: 0, right: 1, top: 2, width: 3 }
                : { height: 2, opacity: 0, right: 2, top: 1, width: 2 }
            }
          />
        </>
      )}
    </div>
  );
}

type PeakMeterProps = {
  left?: number;
  right?: number;
  source?: PeakLevelSource;
  visible?: boolean;
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

/** Audio samples wake one stereo animation; ballistics are elapsed-time based. */
export function PeakMeter({
  left = 0,
  right = 0,
  source,
  visible = true,
  orientation = "vertical",
  className,
  compact = false,
}: PeakMeterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<((left: number, right: number) => void) | null>(
    null
  );
  const levelsRef = useRef({ left, right });
  levelsRef.current = { left, right };
  const isVertical = orientation === "vertical";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const fills = root.querySelectorAll<HTMLElement>("[data-meter-fill]");
    const gradients = root.querySelectorAll<HTMLElement>(
      "[data-meter-gradient]"
    );
    const peaks = compact
      ? []
      : root.querySelectorAll<HTMLElement>("[data-meter-peak]");
    const lines = root.querySelectorAll<HTMLElement>("[data-meter-peak-line]");
    const clips = root.querySelectorAll<HTMLElement>("[data-meter-clip]");
    const channels = [0, 1].map(() => ({
      holdUntil: 0,
      level: 0,
      peak: 0,
      target: 0,
    }));
    let frame: number | null = null;
    let lastFrame = performance.now();
    let sampledAt = Number.NEGATIVE_INFINITY;
    let intersecting = true;
    const canAnimate = () =>
      visible && intersecting && !document.hidden && !root.closest("[hidden]");
    const tick = (now: number) => {
      frame = null;
      if (!canAnimate()) {
        return;
      }
      const elapsed = Math.max(0, now - lastFrame);
      lastFrame = now;
      let animating = false;
      for (const channel of channels) {
        const active = animateChannel(channel, now, elapsed, sampledAt);
        animating ||= active;
      }
      for (const [index, channel] of channels.entries()) {
        paintChannel(
          channel,
          {
            clip: clips[index],
            fill: fills[index],
            gradient: gradients[index],
            line: lines[index],
            peak: peaks[index],
          },
          isVertical
        );
      }
      if (animating) {
        frame = requestAnimationFrame(tick);
      }
    };
    const wake = () => {
      if (
        frame === null &&
        canAnimate() &&
        channels.some(
          (channel) =>
            channel.target > 0 || channel.level > 0 || channel.peak > 0
        )
      ) {
        lastFrame = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const update = (nextLeft: number, nextRight: number) => {
      sampledAt = performance.now();
      for (const [index, channel] of channels.entries()) {
        channel.target = amplify(index === 0 ? nextLeft : nextRight);
      }
      wake();
    };
    updateRef.current = update;
    const initial = source?.getSnapshot() ?? levelsRef.current;
    update(initial.left, initial.right);
    const unsubscribe = source?.subscribe((level) =>
      update(level.left, level.right)
    );
    const updateVisibility = () => {
      if (!canAnimate() && frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      wake();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersecting = entry?.isIntersecting ?? false;
            updateVisibility();
          });
    observer?.observe(root);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      unsubscribe?.();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      updateRef.current = null;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [source, visible, isVertical, compact]);

  useEffect(() => {
    if (!source) {
      updateRef.current?.(left, right);
    }
  }, [left, right, source]);

  return (
    <div
      className={cn("flex", meterLayoutClass(isVertical, compact), className)}
      ref={rootRef}
    >
      <MeterBar compact={compact} orientation={orientation} />
      <MeterBar compact={compact} orientation={orientation} />
    </div>
  );
}
