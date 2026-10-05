// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ListMusicIcon, Music2Icon, Repeat1Icon } from "lucide-react";
import { useState } from "react";
import { RadioNowPlaying } from "@/components/radio/radio-now-playing";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";
import { formatTime } from "../shared/format-utils";
import { useDeckContext } from "./deck-context";
import { DeckMenu } from "./deck-header";

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
    <div className="relative size-11 shrink-0 overflow-hidden rounded-sm border border-border/70 bg-muted">
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
  label,
  isPlaying,
  isLoading,
  isBuffering,
  onPlayPause,
}: {
  label: string;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  onPlayPause: () => void;
}) {
  return (
    <span className="relative shrink-0 rounded-full">
      <PlayPauseButton
        className="size-9 rounded-full"
        iconClassName="size-3.5"
        inline
        isLoading={isLoading}
        isPlaying={isPlaying}
        label={label}
        onClick={onPlayPause}
        size="icon"
        variant={isPlaying && !isLoading ? "outline" : "default"}
      />
      {isBuffering && isPlaying ? (
        <span className="pointer-events-none absolute inset-0 animate-pulse rounded-full ring-2 ring-muted-foreground/40" />
      ) : null}
    </span>
  );
}

const transportToggleClassName =
  "size-7 min-w-7 p-0 text-muted-foreground [@media(pointer:coarse)]:size-9";

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
  if (!(isSeekable || hasTracklist)) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {isSeekable ? (
        <Toggle
          aria-label="Repeat"
          className={transportToggleClassName}
          onPressedChange={setRepeat}
          pressed={repeat}
          size="sm"
          title="Repeat"
        >
          <Repeat1Icon className="size-3.5" />
        </Toggle>
      ) : null}
      {hasTracklist ? (
        <Toggle
          aria-label="Autoplay next track"
          className={transportToggleClassName}
          onPressedChange={setAutoplay}
          pressed={autoplay}
          size="sm"
          title="Autoplay next track"
        >
          <ListMusicIcon className="size-3.5" />
        </Toggle>
      ) : null}
    </div>
  );
}

export function DeckTransport({
  className,
  nowPlaying,
}: {
  className?: string;
  nowPlaying?: RadioNowPlayingMetadata | null;
}) {
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
    metadata,
    play,
    pause,
    setRepeat,
    setAutoplay,
    seek,
    deckId,
    reset,
  } = useDeckContext();

  const handlePlayPause = isPlaying ? pause : play;
  if (!radio) {
    return null;
  }

  const artworkUrl =
    metadata && "artwork" in metadata ? metadata.artwork : radio.logoUrl;
  const title =
    metadata && "name" in metadata ? metadata.name || radio.name : radio.name;

  const isRadioSource =
    !metadata ||
    metadata.platform === "radiogarden" ||
    metadata.platform === "radio-browser" ||
    Boolean(nowPlaying);
  // Live time sits inside the card so starting playback doesn't shift the deck.
  const liveTime =
    isRadioSource && trackProgress && !Number.isFinite(trackProgress.duration)
      ? trackProgress.position
      : null;

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}>
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-2.5 rounded-md border border-border/50 bg-muted/30 p-2 transition-colors",
          isRadioSource && isPlaying && !isLoading && "border-foreground/40"
        )}
      >
        {isRadioSource ? (
          <RadioNowPlaying
            className="flex-1"
            isLoading={isLoading}
            metadata={nowPlaying}
            radio={radio}
          />
        ) : (
          <TransportArtwork
            artworkUrl={artworkUrl}
            isBuffering={isBuffering}
            isPlaying={isPlaying}
            title={title}
          />
        )}

        <div className="flex shrink-0 flex-col-reverse items-center gap-1 lg:flex-row lg:gap-2.5">
          {liveTime === null ? null : (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatTime(liveTime)}
            </span>
          )}
          <TransportPlayButton
            isBuffering={isBuffering}
            isLoading={isLoading}
            isPlaying={isPlaying}
            label={deckId === "deck-a" ? "deck A" : "deck B"}
            onPlayPause={handlePlayPause}
          />
        </div>

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
        {!isRadioSource && (
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden">
            <span
              className="block w-full truncate font-semibold text-sm leading-tight"
              title={title}
            >
              {title}
            </span>
            <TransportProgress onSeek={seek} trackProgress={trackProgress} />
          </div>
        )}

        <DeckMenu
          className="lg:hidden"
          deckId={deckId}
          onReset={reset}
          radio={radio}
        />
      </div>
      {isRadioSource && liveTime === null ? (
        <TransportProgress onSeek={seek} trackProgress={trackProgress} />
      ) : null}
    </div>
  );
}

function TransportProgress({
  trackProgress,
  onSeek,
}: {
  trackProgress?: { position: number; duration: number };
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
      onSeek={onSeek}
      position={trackProgress.position}
    />
  );
}

/** A seek bar with position and duration; it seeks once, on release. */
export function SeekableProgress({
  duration,
  position,
  onSeek,
}: {
  duration: number;
  position: number;
  onSeek: (position: number) => void;
}) {
  // Follow the pointer while dragging; seek once, on release.
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const shownPosition = dragPosition ?? position;
  const handleDrag = ([value]: number[]) => setDragPosition(value ?? 0);
  const handleCommit = ([value]: number[]) => {
    setDragPosition(null);
    onSeek(Math.max(0, Math.min(value ?? 0, duration)));
  };

  return (
    <div className="w-full space-y-1">
      <Slider
        aria-label="Seek position"
        max={duration}
        min={0}
        onValueChange={handleDrag}
        onValueCommit={handleCommit}
        resetValue={[0]}
        step={1}
        value={[shownPosition]}
      />
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
        <span>{formatTime(shownPosition)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
