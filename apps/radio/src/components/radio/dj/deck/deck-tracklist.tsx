import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import type { PlatformTrack } from "@/lib/platform-types";
import { useDeckContext } from "./deck-context";

export function getTrackPlayUrl(track: PlatformTrack): string {
  let candidate = "";
  if (track.streamUrl) {
    candidate = track.streamUrl;
  }
  if (!candidate && "videoId" in track && track.videoId) {
    candidate = `yt:${track.videoId}`;
  }

  if (!candidate) {
    return "";
  }

  const validation = validatePlaybackStreamUrl(candidate);
  return validation.ok ? validation.normalizedUrl : "";
}

export function findTrackPlayUrlInDirection(
  tracks: PlatformTrack[],
  currentTrackIndex: number,
  direction: -1 | 1
): string {
  let targetIndex = currentTrackIndex + direction;
  while (targetIndex >= 0 && targetIndex < tracks.length) {
    const track = tracks[targetIndex];
    if (!track) {
      return "";
    }
    const url = getTrackPlayUrl(track);
    if (url) {
      return url;
    }
    targetIndex += direction;
  }
  return "";
}

function getTrackKey(track: PlatformTrack) {
  return [
    "videoId" in track ? track.videoId : "",
    track.streamUrl,
    track.name,
    track.duration ?? "",
    "trackNumber" in track ? (track.trackNumber ?? "") : "",
  ].join(":");
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
              key={getTrackKey(track)}
              track={track}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function TracklistNavigation() {
  const { tracks, currentTrackIndex, loadTrack } = useDeckContext();

  if (!tracks) {
    return null;
  }

  const nextUrl = findTrackPlayUrlInDirection(tracks, currentTrackIndex, 1);
  const previousUrl = findTrackPlayUrlInDirection(
    tracks,
    currentTrackIndex,
    -1
  );
  const hasNext = Boolean(nextUrl);
  const hasPrevious = Boolean(previousUrl);

  const handleNavigate = (direction: -1 | 1) => {
    const url = findTrackPlayUrlInDirection(
      tracks,
      currentTrackIndex,
      direction
    );
    if (url) {
      loadTrack(url).catch(() => {
        // Errors are surfaced by deck actions/telemetry.
      });
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
  const { loadTrack } = useDeckContext();

  const handlePlay = () => {
    const url = getTrackPlayUrl(track);
    if (url) {
      loadTrack(url).catch(() => {
        // Errors are surfaced by deck actions/telemetry.
      });
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
