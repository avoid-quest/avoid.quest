import { cn } from "@avoid.quest/ui/lib/utils";
import { useMemo } from "react";
import { useDeckWaveformHistory } from "@/lib/hooks/use-deck-waveform-history";
import { useDeckContext } from "./deck-context";
import { formatTime } from "../shared/format-utils";

function deckTone(deckSide: "left" | "right") {
  return deckSide === "left"
    ? {
        accent: "rgba(255,255,255,0.88)",
        accentSoft: "rgba(255,255,255,0.08)",
      }
    : {
        accent: "rgba(255,255,255,0.82)",
        accentSoft: "rgba(255,255,255,0.07)",
      };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getUpcomingTrackName(
  tracks: { name: string }[] | undefined,
  currentTrackIndex: number
): string | null {
  if (!tracks || tracks.length === 0) {
    return null;
  }
  return tracks[currentTrackIndex + 1]?.name ?? null;
}

function TrackOverviewWaveform({
  samples,
  progress,
  accent,
}: {
  samples: number[];
  progress: number;
  accent: string;
}) {
  return (
    <div className="space-y-1">
      <div className="relative h-14 overflow-hidden rounded-sm bg-white/[0.03] px-1.5 py-1.5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/5" />
        <div className="flex h-full items-center gap-px">
          {samples.map((value, index) => {
            const height = Math.max(3, clamp01(value) * 100 * 0.92);
            return (
              <div className="flex h-full flex-1 items-center justify-center" key={index}>
                <div
                  className="w-full rounded-full"
                  style={{
                    height,
                    background: accent,
                    opacity: 0.12 + clamp01(value) * 0.88,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-y-1 w-px bg-white"
          style={{ left: `calc(${clamp01(progress) * 100}% - 0.5px)` }}
        />
      </div>
    </div>
  );
}

function LiveRollingWaveform({
  samples,
  accent,
}: {
  samples: number[];
  accent: string;
}) {
  return (
    <div className="space-y-1">
      <div className="relative h-14 overflow-hidden rounded-sm bg-white/[0.03] px-1.5 py-1.5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/5" />
        <div className="flex h-full items-center gap-px">
          {samples.map((value, index) => {
            const height = Math.max(3, clamp01(value) * 100 * 0.92);
            return (
              <div className="flex h-full flex-1 items-center justify-center" key={index}>
                <div
                  className="w-full rounded-full"
                  style={{
                    height,
                    background: accent,
                    opacity: 0.12 + clamp01(value) * 0.88,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-1 right-1.5 w-px bg-white/70" />
      </div>
    </div>
  );
}

export function DeckVisualizer({ className }: { className?: string }) {
  const {
    deckSide,
    soundId,
    trackProgress,
    isSeekable,
    hasTracklist,
    tracks,
    currentTrackIndex,
  } = useDeckContext();

  const tone = deckTone(deckSide);
  const { samples, liveWindowSeconds } = useDeckWaveformHistory(
    soundId,
    Boolean(soundId)
  );

  const progress =
    isSeekable && trackProgress && trackProgress.duration > 0
      ? clamp01(trackProgress.position / trackProgress.duration)
      : 0;

  const remaining =
    isSeekable && trackProgress
      ? Math.max(0, trackProgress.duration - trackProgress.position)
      : 0;

  const upcomingTrack = hasTracklist
    ? getUpcomingTrackName(tracks, currentTrackIndex)
    : null;

  const leftLabel = isSeekable
    ? formatTime(trackProgress?.position ?? 0)
    : `-${Math.round(liveWindowSeconds)}s`;
  const rightLabel = isSeekable
    ? `-${formatTime(remaining)}`
    : "now";

  const centerLabel = isSeekable
    ? formatTime(trackProgress?.duration ?? 0)
    : null;

  const summaryLabel = isSeekable
    ? hasTracklist && tracks
      ? `${Math.min(currentTrackIndex + 1, tracks.length)}/${tracks.length}`
      : "track"
    : "live";

  const footerLabel = upcomingTrack ?? "";

  const normalizedSamples = useMemo(() => {
    if (!samples.length) {
      return [];
    }

    if (isSeekable) {
      return samples;
    }

    const max = Math.max(...samples, 0.0001);
    return samples.map((value) => value / max);
  }, [isSeekable, samples]);

  return (
    <div className={cn("space-y-1.5 px-0.5 py-1", className)}>
      {isSeekable ? (
        <TrackOverviewWaveform
          accent={tone.accent}
          progress={progress}
          samples={normalizedSamples}
        />
      ) : (
        <LiveRollingWaveform accent={tone.accent} samples={normalizedSamples} />
      )}

      <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-muted-foreground/60">
        <span>{leftLabel}</span>
        <span>{summaryLabel}</span>
        <span>{rightLabel}</span>
      </div>

      {(centerLabel || footerLabel) && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/50">
          <span className="font-mono tabular-nums">{centerLabel ?? ""}</span>
          <span className="truncate text-right">{footerLabel}</span>
        </div>
      )}
    </div>
  );
}
