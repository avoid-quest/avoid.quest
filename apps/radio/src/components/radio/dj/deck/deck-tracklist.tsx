// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
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
    "title" in track ? track.title : track.name,
    track.duration ?? "",
    "trackNumber" in track ? (track.trackNumber ?? "") : "",
  ].join(":");
}

export function DeckTracklist({ className }: { className?: string }) {
  const { tracks, currentTrackIndex, hasTracklist, loadTrack } =
    useDeckContext();

  if (!(hasTracklist && tracks) || tracks.length === 0) {
    return null;
  }

  return (
    <TracklistView
      className={className}
      currentTrackIndex={currentTrackIndex}
      onPlayTrack={loadTrack}
      tracks={tracks}
    />
  );
}

type TracklistViewProps = {
  tracks: PlatformTrack[];
  currentTrackIndex: number;
  /** Plays a track by its play URL; errors are surfaced by the caller. */
  onPlayTrack: (url: string) => Promise<unknown>;
  className?: string;
};

/**
 * An album's or playlist's tracks with previous and next, the current one
 * marked. Presentational: a DJ deck and a Node Track each say what a pick
 * plays.
 */
export function TracklistView({
  tracks,
  currentTrackIndex,
  onPlayTrack,
  className,
}: TracklistViewProps) {
  const playUrl = (url: string) => {
    if (url) {
      onPlayTrack(url).catch(() => {
        // Errors are surfaced by deck actions/telemetry.
      });
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <TracklistNavigation
        currentTrackIndex={currentTrackIndex}
        onPlay={playUrl}
        tracks={tracks}
      />
      <ScrollArea className="h-40 rounded-md border border-border/50">
        <div className="space-y-0.5 p-1">
          {tracks.map((track, index) => (
            <TrackRow
              index={index}
              isCurrent={index === currentTrackIndex}
              key={getTrackKey(track)}
              onPlay={playUrl}
              track={track}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function TracklistNavigation({
  tracks,
  currentTrackIndex,
  onPlay,
}: {
  tracks: PlatformTrack[];
  currentTrackIndex: number;
  onPlay: (url: string) => void;
}) {
  const nextUrl = findTrackPlayUrlInDirection(tracks, currentTrackIndex, 1);
  const previousUrl = findTrackPlayUrlInDirection(
    tracks,
    currentTrackIndex,
    -1
  );
  const handlePrevious = () => onPlay(previousUrl);
  const handleNext = () => onPlay(nextUrl);

  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label="Previous track"
        className="size-7 [@media(pointer:coarse)]:size-9"
        disabled={!previousUrl}
        onClick={handlePrevious}
        size="icon"
        variant="ghost"
      >
        <ChevronLeftIcon className="size-3.5" />
      </Button>
      <Button
        aria-label="Next track"
        className="size-7 [@media(pointer:coarse)]:size-9"
        disabled={!nextUrl}
        onClick={handleNext}
        size="icon"
        variant="ghost"
      >
        <ChevronRightIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function TrackRow({
  track,
  index,
  isCurrent,
  onPlay,
}: {
  track: PlatformTrack;
  index: number;
  isCurrent: boolean;
  onPlay: (url: string) => void;
}) {
  const handlePlay = () => onPlay(getTrackPlayUrl(track));

  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isCurrent && "bg-muted/40 font-medium"
      )}
      onClick={handlePlay}
      type="button"
    >
      <div className="flex size-4 shrink-0 items-center justify-center">
        {isCurrent ? (
          <PlayIcon aria-label="Current track" className="size-2.5" />
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {index + 1}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">
          {"title" in track ? track.title : track.name}
        </div>
      </div>
      {track.duration ? (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {formatPlatformDuration(track.duration)}
        </span>
      ) : null}
    </button>
  );
}
