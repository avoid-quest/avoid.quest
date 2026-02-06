import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import type { PlatformTrack } from "@/lib/platform-types";
import { useDeckContext } from "./deck-context";

function getTrackPlayUrl(track: PlatformTrack): string {
  if (track.streamUrl) {
    return track.streamUrl;
  }
  if ("videoId" in track && track.videoId) {
    return `yt:${track.videoId}`;
  }
  return "";
}

export function DeckTracklist({ className }: { className?: string }) {
  const { tracks, currentTrackIndex, hasTracklist } = useDeckContext();

  if (!(hasTracklist && tracks) || tracks.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <TracklistNavigation />
      <ScrollArea className="h-40 rounded-md border border-border/50">
        <div className="space-y-0.5 p-1">
          {tracks.map((track, index) => (
            <TrackRow
              index={index}
              isCurrent={index === currentTrackIndex}
              key={`${index}-${track.name}`}
              track={track}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function TracklistNavigation() {
  const { tracks, currentTrackIndex, loadTrack, radio, deckSide } =
    useDeckContext();

  if (!tracks) {
    return null;
  }

  const hasNext = currentTrackIndex < tracks.length - 1;
  const hasPrevious = currentTrackIndex > 0;

  const handleNavigate = (direction: -1 | 1) => {
    const targetIndex = currentTrackIndex + direction;
    const track = tracks[targetIndex];
    if (track && radio) {
      const url = getTrackPlayUrl(track);
      if (url) {
        loadTrack(deckSide, { ...radio, streamUrl: url }, true);
      }
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label="Previous track"
        className="h-6 w-6 p-0"
        disabled={!hasPrevious}
        onClick={() => handleNavigate(-1)}
        size="sm"
        variant="ghost"
      >
        <ChevronLeftIcon className="size-3.5" />
      </Button>
      <Button
        aria-label="Next track"
        className="h-6 w-6 p-0"
        disabled={!hasNext}
        onClick={() => handleNavigate(1)}
        size="sm"
        variant="ghost"
      >
        <ChevronRightIcon className="size-3.5" />
      </Button>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {currentTrackIndex + 1}/{tracks.length}
      </span>
    </div>
  );
}

function TrackRow({
  track,
  index,
  isCurrent,
}: {
  track: PlatformTrack;
  index: number;
  isCurrent: boolean;
}) {
  const { loadTrack, radio, deckSide } = useDeckContext();

  const handlePlay = () => {
    if (!radio) {
      return;
    }
    const url = getTrackPlayUrl(track);
    if (url) {
      loadTrack(deckSide, { ...radio, streamUrl: url }, true);
    }
  };

  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
        isCurrent && "bg-primary/10"
      )}
      onClick={handlePlay}
      type="button"
    >
      <div className="flex size-4 shrink-0 items-center justify-center">
        {isCurrent ? (
          <PlayIcon className="size-2.5 text-primary" />
        ) : (
          <span className="font-mono text-[9px] text-muted-foreground">
            {index + 1}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{track.name}</div>
      </div>
      {track.duration && (
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">
          {formatPlatformDuration(track.duration)}
        </span>
      )}
    </button>
  );
}
