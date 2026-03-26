import { cn } from "@avoid.quest/ui/lib/utils";
import { useMemo } from "react";
import { useDeckWaveformHistory } from "@/lib/hooks/use-deck-waveform-history";
import { useTrackWaveformOverview } from "@/lib/hooks/use-track-waveform-overview";
import { useDeckContext } from "./deck-context";
import { formatTime } from "../shared/format-utils";

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

function WaveformBars({
  samples,
  playhead,
}: {
  samples: number[];
  playhead?: number;
}) {
  return (
    <div className="relative h-14 overflow-hidden rounded-sm bg-white/[0.03] px-1.5 py-1.5">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/5" />
      <div className="flex h-full items-center gap-px">
        {samples.map((value, index) => {
          const height = Math.max(3, clamp01(value) * 100 * 0.92);
          return (
            <div className="flex h-full flex-1 items-center justify-center" key={index}>
              <div
                className="w-full rounded-full bg-white/85"
                style={{
                  height,
                  opacity: 0.12 + clamp01(value) * 0.88,
                }}
              />
            </div>
          );
        })}
      </div>
      {playhead !== undefined && (
        <div
          className="pointer-events-none absolute inset-y-1 w-px bg-white"
          style={{ left: `calc(${clamp01(playhead) * 100}% - 0.5px)` }}
        />
      )}
    </div>
  );
}

export function DeckVisualizer({ className }: { className?: string }) {
  const {
    radio,
    soundId,
    trackProgress,
    isSeekable,
    hasTracklist,
    tracks,
    currentTrackIndex,
    metadata,
  } = useDeckContext();

  const { samples: liveSamples, liveWindowSeconds } = useDeckWaveformHistory(
    soundId,
    Boolean(soundId) && !isSeekable
  );

  const { samples: overviewSamples, loading: overviewLoading } =
    useTrackWaveformOverview(radio, metadata, isSeekable);

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

  const liveNormalized = useMemo(() => {
    if (!liveSamples.length) {
      return [];
    }
    const max = Math.max(...liveSamples, 0.0001);
    return liveSamples.map((value) => value / max);
  }, [liveSamples]);

  const waveformSamples = isSeekable
    ? overviewSamples ?? Array.from({ length: 120 }, () => 0)
    : liveNormalized;

  const leftLabel = isSeekable
    ? formatTime(trackProgress?.position ?? 0)
    : `-${Math.round(liveWindowSeconds)}s`;
  const centerLabel = isSeekable
    ? formatTime(trackProgress?.duration ?? 0)
    : "live";
  const rightLabel = isSeekable ? `-${formatTime(remaining)}` : "now";

  return (
    <div className={cn("space-y-1.5 px-0.5 py-1", className)}>
      <WaveformBars
        playhead={isSeekable ? progress : undefined}
        samples={waveformSamples}
      />

      <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-muted-foreground/60">
        <span>{leftLabel}</span>
        <span>{centerLabel}</span>
        <span>{rightLabel}</span>
      </div>

      {(upcomingTrack || overviewLoading || (hasTracklist && tracks)) && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/50">
          <span className="font-mono tabular-nums">
            {hasTracklist && tracks
              ? `${Math.min(currentTrackIndex + 1, tracks.length)}/${tracks.length}`
              : overviewLoading
                ? "analysis"
                : ""}
          </span>
          <span className="truncate text-right">{upcomingTrack ?? ""}</span>
        </div>
      )}
    </div>
  );
}
