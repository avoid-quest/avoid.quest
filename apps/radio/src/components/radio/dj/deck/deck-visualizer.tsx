import { cn } from "@avoid.quest/ui/lib/utils";
import { useMemo } from "react";
import { useDeckWaveformHistory } from "@/lib/hooks/use-deck-waveform-history";
import { useDeckContext } from "./deck-context";
import { PeakMeter } from "../shared/peak-meter";
import { formatTime } from "../shared/format-utils";

function deckTone(deckSide: "left" | "right") {
  return deckSide === "left"
    ? {
        accent: "#2dd4bf",
        accentSoft: "rgba(45, 212, 191, 0.12)",
        border: "border-emerald-400/10",
      }
    : {
        accent: "#22c55e",
        accentSoft: "rgba(34, 197, 94, 0.12)",
        border: "border-lime-400/10",
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

function RollingWaveform({
  samples,
  progress,
  accent,
  isLive,
}: {
  samples: number[];
  progress: number | null;
  accent: string;
  isLive: boolean;
}) {
  const bars = useMemo(() => {
    if (samples.length === 0) {
      return [];
    }
    return samples.map((value) => clamp01(value));
  }, [samples]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
          {isLive ? "Live buffer" : "Track waveform"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/55">
          {isLive ? "recent audio" : "time-aligned"}
        </span>
      </div>

      <div className="relative h-14 overflow-hidden rounded-sm border border-white/5 bg-black/20 px-1.5 py-1.5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/5" />

        <div className="flex h-full items-center gap-px">
          {bars.map((value, index) => {
            const height = Math.max(4, value * 100 * 0.9);
            return (
              <div className="flex h-full flex-1 items-center justify-center" key={index}>
                <div
                  className="w-full rounded-full"
                  style={{
                    height,
                    background: accent,
                    opacity: 0.12 + value * 0.88,
                  }}
                />
              </div>
            );
          })}
        </div>

        {progress !== null && (
          <div
            className="pointer-events-none absolute inset-y-1 w-px bg-white/70"
            style={{ left: `calc(${clamp01(progress) * 100}% - 0.5px)` }}
          />
        )}
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
    peakLevel,
    isPlaying,
  } = useDeckContext();

  const tone = deckTone(deckSide);
  const { samples, hasSignal } = useDeckWaveformHistory(soundId, Boolean(soundId));

  const progress =
    isSeekable && trackProgress && trackProgress.duration > 0
      ? clamp01(trackProgress.position / trackProgress.duration)
      : null;

  const remaining =
    isSeekable && trackProgress
      ? Math.max(0, trackProgress.duration - trackProgress.position)
      : 0;

  const currentLabel = isSeekable
    ? `${formatTime(trackProgress?.position ?? 0)} / ${formatTime(trackProgress?.duration ?? 0)}`
    : isPlaying
      ? "LIVE"
      : "IDLE";

  const upcomingTrack = hasTracklist
    ? getUpcomingTrackName(tracks, currentTrackIndex)
    : null;

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border bg-transparent px-0.5 py-1",
        tone.border,
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
          Waveform
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {isSeekable ? `−${formatTime(remaining)}` : isPlaying ? "live" : "idle"}
        </span>
      </div>

      <div
        className="space-y-2 rounded-md border border-white/5 px-2 py-2"
        style={{ background: tone.accentSoft }}
      >
        <RollingWaveform
          accent={tone.accent}
          isLive={!isSeekable}
          progress={progress}
          samples={samples}
        />

        <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          <span>{currentLabel}</span>
          {hasTracklist && tracks ? (
            <span>
              {Math.min(currentTrackIndex + 1, tracks.length)}/{tracks.length}
            </span>
          ) : (
            <span>{hasSignal ? "buffered" : "waiting"}</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-white/5 border-t pt-1.5">
          {upcomingTrack ? (
            <>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/55">
                Next
              </span>
              <span className="truncate text-right text-[11px] text-muted-foreground/80">
                {upcomingTrack}
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/55">
                Signal
              </span>
              <div className="w-28">
                <PeakMeter
                  compact
                  left={peakLevel.left}
                  orientation="horizontal"
                  right={peakLevel.right}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
