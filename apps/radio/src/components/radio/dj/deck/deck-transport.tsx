// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  ListMusicIcon,
  Music2Icon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
} from "lucide-react";
import { formatTime } from "../shared/format-utils";
import { useDeckContext } from "./deck-context";

function TransportArtwork({
  artworkUrl,
  title,
  isBuffering,
  isPlaying,
}: {
  artworkUrl: string | undefined;
  title: string;
  isBuffering: boolean;
  isPlaying: boolean;
}) {
  return (
    <div className="relative size-11 shrink-0 overflow-hidden rounded border border-border/50 bg-black/20">
      {artworkUrl ? (
        <img
          alt={title}
          className="h-full w-full object-cover"
          height={44}
          src={artworkUrl}
          width={44}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Music2Icon className="size-4 text-muted-foreground/40" />
        </div>
      )}
      {isBuffering && isPlaying ? (
        <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
      ) : null}
    </div>
  );
}

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
  let icon = <PlayIcon className="ml-0.5 size-3.5" />;
  if (isLoading) {
    icon = (
      <div className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
    );
  } else if (isPlaying) {
    icon = <PauseIcon className="size-3.5" />;
  }

  return (
    <button
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full transition-all",
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
      {icon}
      {isBuffering && isPlaying ? (
        <span className="pointer-events-none absolute inset-0 animate-pulse rounded-full ring-2 ring-muted-foreground/40" />
      ) : null}
    </button>
  );
}

function TransportToggles({
  autoplay,
  hasTracklist,
  isSeekable,
  repeat,
  setAutoplay,
  setRepeat,
}: {
  autoplay: boolean;
  hasTracklist: boolean;
  isSeekable: boolean;
  repeat: boolean;
  setAutoplay: (autoplay: boolean) => void;
  setRepeat: (repeat: boolean) => void;
}) {
  const handleRepeatToggle = () => setRepeat(!repeat);
  const handleAutoplayToggle = () => setAutoplay(!autoplay);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {isSeekable ? (
        <button
          aria-label={repeat ? "Disable repeat" : "Enable repeat"}
          className={cn(
            "flex size-6 items-center justify-center rounded-full transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            repeat
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          )}
          onClick={handleRepeatToggle}
          type="button"
        >
          <Repeat1Icon className="size-3" />
        </button>
      ) : null}
      {hasTracklist ? (
        <button
          aria-label={autoplay ? "Disable autoplay" : "Enable autoplay"}
          className={cn(
            "flex size-6 items-center justify-center rounded-full transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            autoplay
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          )}
          onClick={handleAutoplayToggle}
          title={autoplay ? "Autoplay enabled" : "Autoplay disabled"}
          type="button"
        >
          <ListMusicIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export function DeckTransport({ className }: { className?: string }) {
  const {
    radio,
    isPlaying,
    isLoading,
    isBuffering,
    trackProgress,
    repeat,
    autoplay,
    hasTracklist,
    isSeekable,
    deckSide,
    metadata,
    play,
    pause,
    setRepeat,
    setAutoplay,
    seek,
  } = useDeckContext();

  const handlePlayPause = isPlaying ? pause : play;
  if (!radio) {
    return null;
  }

  const artworkUrl =
    metadata && "artwork" in metadata ? metadata.artwork : radio.logoUrl;
  const title =
    metadata && "name" in metadata ? metadata.name || radio.name : radio.name;

  const isRight = deckSide === "right";

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}>
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-2.5 rounded-md border border-border/50 bg-muted/30 p-2",
          isRight && "flex-row-reverse"
        )}
      >
        <TransportArtwork
          artworkUrl={artworkUrl}
          isBuffering={isBuffering}
          isPlaying={isPlaying}
          title={title}
        />

        <TransportPlayButton
          isBuffering={isBuffering}
          isLoading={isLoading}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
        />

        {/* Repeat / Autoplay toggles */}
        <TransportToggles
          autoplay={autoplay}
          hasTracklist={hasTracklist}
          isSeekable={isSeekable}
          repeat={repeat}
          setAutoplay={setAutoplay}
          setRepeat={setRepeat}
        />

        {/* Title + progress */}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden",
            isRight && "items-end"
          )}
        >
          <span
            className={cn(
              "block w-full overflow-hidden truncate text-ellipsis whitespace-nowrap font-semibold text-sm leading-tight",
              isRight && "text-right"
            )}
            title={title}
          >
            {title}
          </span>
          <TransportProgress
            isBuffering={isBuffering}
            isPlaying={isPlaying}
            onSeek={seek}
            trackProgress={trackProgress}
          />
        </div>
      </div>
    </div>
  );
}

function TransportProgress({
  trackProgress,
  isBuffering,
  isPlaying,
  onSeek,
}: {
  trackProgress?: { position: number; duration: number };
  isBuffering: boolean;
  isPlaying: boolean;
  onSeek: (position: number) => void;
}) {
  if (!trackProgress) {
    return null;
  }

  const isLiveStream = !Number.isFinite(trackProgress.duration);
  const hasValidDuration = trackProgress.duration > 0;

  if (isLiveStream) {
    return (
      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {formatTime(trackProgress.position)}
      </div>
    );
  }

  if (!hasValidDuration) {
    return null;
  }

  return (
    <SeekableProgress
      duration={trackProgress.duration}
      isBuffering={isBuffering}
      isPlaying={isPlaying}
      onSeek={onSeek}
      position={trackProgress.position}
    />
  );
}

function SeekableProgress({
  duration,
  position,
  isBuffering,
  isPlaying,
  onSeek,
}: {
  duration: number;
  position: number;
  isBuffering: boolean;
  isPlaying: boolean;
  onSeek: (position: number) => void;
}) {
  const progress = (position / duration) * 100;
  const handleBarClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const nextPosition = (clickX / rect.width) * duration;
    onSeek(Math.max(0, Math.min(nextPosition, duration)));
  };

  let fillColor = "bg-primary/60";
  if (isBuffering) {
    fillColor = "bg-muted-foreground/70";
  } else if (isPlaying) {
    fillColor = "bg-primary";
  }

  return (
    <div className="w-full space-y-0.5">
      <button
        aria-label="Seek position"
        className="relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-muted-foreground/20"
        onClick={handleBarClick}
        type="button"
      >
        <div
          className={cn(
            "pointer-events-none h-full rounded-full transition-all duration-300 ease-out",
            fillColor
          )}
          style={{ width: `${progress}%` }}
        />
      </button>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
        <span>{formatTime(position)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
