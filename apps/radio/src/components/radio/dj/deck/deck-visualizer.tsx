import { cn } from "@avoid.quest/ui/lib/utils";
import { useDeckContext } from "./deck-context";
import { PeakMeter } from "../shared/peak-meter";
import { formatTime } from "../shared/format-utils";

function deckTone(deckSide: "left" | "right") {
  return deckSide === "left"
    ? {
        accent: "bg-blue-400/80",
        rail: "bg-blue-500/10",
        border: "border-blue-500/10",
        text: "text-blue-200/85",
      }
    : {
        accent: "bg-pink-400/80",
        rail: "bg-pink-500/10",
        border: "border-pink-500/10",
        text: "text-pink-200/85",
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
  const next = tracks[currentTrackIndex + 1];
  return next?.name ?? null;
}

function TimelineBar({
  progress,
  accentClass,
  railClass,
}: {
  progress: number;
  accentClass: string;
  railClass: string;
}) {
  const normalized = clamp01(progress);
  const segmentCount = 24;
  const activeSegments = Math.round(normalized * segmentCount);

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 items-center gap-1">
        {Array.from({ length: segmentCount }, (_, index) => {
          const active = index < activeSegments;
          return (
            <div
              className={cn(
                "h-full flex-1 rounded-full transition-opacity duration-300",
                active ? accentClass : railClass,
                active ? "opacity-100" : "opacity-55"
              )}
              key={index}
            />
          );
        })}
      </div>
    </div>
  );
}

export function DeckVisualizer({ className }: { className?: string }) {
  const {
    deckSide,
    trackProgress,
    isSeekable,
    hasTracklist,
    tracks,
    currentTrackIndex,
    peakLevel,
    isPlaying,
  } = useDeckContext();

  const tone = deckTone(deckSide);
  const progress =
    isSeekable && trackProgress && trackProgress.duration > 0
      ? clamp01(trackProgress.position / trackProgress.duration)
      : 0;

  const remaining =
    isSeekable && trackProgress
      ? Math.max(0, trackProgress.duration - trackProgress.position)
      : 0;

  const currentLabel = isSeekable
    ? `${formatTime(trackProgress?.position ?? 0)} / ${formatTime(trackProgress?.duration ?? 0)}`
    : "LIVE";

  const statusLabel = isSeekable
    ? `−${formatTime(remaining)}`
    : isPlaying
      ? "live"
      : "idle";

  const upcomingTrack = hasTracklist
    ? getUpcomingTrackName(tracks, currentTrackIndex)
    : null;

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border border-border/40 bg-transparent px-0.5 py-1",
        tone.border,
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
          Timeline
        </span>
        <span className={cn("font-mono text-[10px]", tone.text)}>
          {statusLabel}
        </span>
      </div>

      <div className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-2">
        <TimelineBar
          accentClass={tone.accent}
          progress={progress}
          railClass={tone.rail}
        />

        <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          <span>{currentLabel}</span>
          {hasTracklist && tracks ? (
            <span>
              {Math.min(currentTrackIndex + 1, tracks.length)}/{tracks.length}
            </span>
          ) : (
            <span>{isSeekable ? "track" : "stream"}</span>
          )}
        </div>

        {upcomingTrack ? (
          <div className="flex items-center justify-between gap-2 border-white/5 border-t pt-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/55">
              Next
            </span>
            <span className="truncate text-right text-[11px] text-muted-foreground/80">
              {upcomingTrack}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-white/5 border-t pt-1.5">
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
          </div>
        )}
      </div>
    </div>
  );
}
