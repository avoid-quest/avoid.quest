import { cn } from "@workspace/ui/lib/utils";
import { Music2Icon, PauseIcon, PlayIcon } from "lucide-react";

type DeckTransportBarProps = {
  artworkUrl?: string;
  title: string;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  trackProgress?: { position: number; duration: number };
  onPlayPause: () => void;
  className?: string;
};

function formatTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) {
    return "0:00";
  }
  if (!Number.isFinite(seconds)) {
    return "LIVE";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getProgressBarColor(isBuffering: boolean, isPlaying: boolean): string {
  if (isBuffering) {
    return "bg-amber-500/70";
  }
  if (isPlaying) {
    return "bg-primary";
  }
  return "bg-primary/60";
}

/**
 * Artwork thumbnail with placeholder
 */
function TransportArtwork({
  artworkUrl,
  title,
}: {
  artworkUrl?: string;
  title: string;
}) {
  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-md border bg-muted">
      {artworkUrl ? (
        <img
          alt={title}
          className="h-full w-full object-cover"
          height={48}
          src={artworkUrl}
          width={48}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Music2Icon className="size-5 text-muted-foreground/50" />
        </div>
      )}
    </div>
  );
}

/**
 * Play/Pause button with loading and buffering states
 */
function TransportPlayButton({
  isPlaying,
  isLoading,
  isBuffering,
  onPlayPause,
}: {
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  onPlayPause: () => void;
}) {
  return (
    <button
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-200",
        "bg-primary text-primary-foreground shadow-sm",
        "hover:bg-primary/90 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        isPlaying && "bg-primary/90"
      )}
      disabled={isLoading}
      onClick={onPlayPause}
      type="button"
    >
      {isLoading && (
        <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
      )}
      {!isLoading && isPlaying && <PauseIcon className="size-4" />}
      {!(isLoading || isPlaying) && <PlayIcon className="ml-0.5 size-4" />}

      {isBuffering && isPlaying && (
        <span className="pointer-events-none absolute inset-0 animate-pulse rounded-full ring-2 ring-amber-500/60" />
      )}
    </button>
  );
}

/**
 * Progress bar with time display
 * Shows progress bar for finite tracks, elapsed time for live streams
 */
function TransportProgress({
  trackProgress,
  isBuffering,
  isPlaying,
}: {
  trackProgress?: { position: number; duration: number };
  isBuffering: boolean;
  isPlaying: boolean;
}) {
  // No progress data yet
  if (!trackProgress) {
    return null;
  }

  const isLiveStream = !Number.isFinite(trackProgress.duration);
  const hasValidDuration = trackProgress.duration > 0;

  // For live streams: show elapsed time only
  if (isLiveStream) {
    return (
      <div className="font-mono text-[10px] text-muted-foreground">
        {formatTime(trackProgress.position)}
      </div>
    );
  }

  // For finite tracks without valid duration yet, don't show anything
  if (!hasValidDuration) {
    return null;
  }

  // Finite track: show progress bar
  const progress = (trackProgress.position / trackProgress.duration) * 100;

  return (
    <div className="space-y-0.5">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/20">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300 ease-out",
            getProgressBarColor(isBuffering, isPlaying)
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{formatTime(trackProgress.position)}</span>
        <span>{formatTime(trackProgress.duration)}</span>
      </div>
    </div>
  );
}

/**
 * Compact transport bar with artwork, play button, track name, and progress.
 * Integrates the former DeckHeader functionality for a more prominent progress display.
 */
export function DeckTransportBar({
  artworkUrl,
  title,
  isPlaying,
  isLoading,
  isBuffering,
  trackProgress,
  onPlayPause,
  className,
}: DeckTransportBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-muted/40 p-2",
        className
      )}
    >
      <TransportArtwork artworkUrl={artworkUrl} title={title} />

      <TransportPlayButton
        isBuffering={isBuffering}
        isLoading={isLoading}
        isPlaying={isPlaying}
        onPlayPause={onPlayPause}
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span
          className="truncate font-semibold text-sm leading-tight"
          title={title}
        >
          {title}
        </span>

        <TransportProgress
          isBuffering={isBuffering}
          isPlaying={isPlaying}
          trackProgress={trackProgress}
        />
      </div>
    </div>
  );
}
