import { Button } from "@workspace/ui/components/button";
import { PlayPauseButton } from "@workspace/ui/components/play-pause-button";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { ExternalLink, Link2, Music2, X } from "lucide-react";
import type { PlatformMetadata } from "@/lib/external-url/types";
import type { Radio } from "@/lib/types";
import { RadioNameLink } from "../radio-name-link";

type DeckLayoutProps = {
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  metadata?: PlatformMetadata;
  trackProgress?: {
    position: number;
    duration: number;
  };
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onClear: () => void;
  onChangeUrl?: () => void;
  className?: string;
};

export function DeckLayout({
  radio,
  isPlaying,
  isLoading,
  volume,
  metadata,
  trackProgress,
  onPlayPause,
  onVolumeChange,
  onClear,
  onChangeUrl,
  className,
  children,
}: DeckLayoutProps & { children?: React.ReactNode }) {
  const formatTime = (seconds: number) => {
    if (!seconds || Number.isNaN(seconds)) {
      return "0:00";
    }
    if (!Number.isFinite(seconds)) {
      return "LIVE";
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const artworkUrl = metadata?.artwork || radio.logoUrl;
  const title = metadata?.name || radio.name;
  const artist =
    metadata?.artist ||
    (metadata?.platform === "soundcloud" ? "SoundCloud" : "Radio");

  // Calculate progress percentage
  const isLive =
    trackProgress?.duration === Number.POSITIVE_INFINITY ||
    trackProgress?.duration === 0 || // Some live streams might report 0
    (trackProgress?.duration !== undefined &&
      !Number.isFinite(trackProgress.duration));

  const progress =
    !isLive && trackProgress?.duration
      ? (trackProgress.position / trackProgress.duration) * 100
      : 0;

  const hasChildren = !!children;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Main Content Area - Pushes footer down */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Section: Artwork & Controls */}
        {/* If no children (playlist), we center this section vertically */}
        <div
          className={cn(
            "flex flex-col space-y-4",
            !hasChildren && "flex-1 items-center justify-center text-center"
          )}
        >
          <DeckInfo
            artist={artist}
            artworkUrl={artworkUrl}
            hasChildren={hasChildren}
            metadata={metadata || null}
            radio={radio}
            title={title}
          />

          <DeckProgress
            formatTime={formatTime}
            hasChildren={hasChildren}
            isLive={isLive ?? false}
            metadata={metadata ?? null}
            progress={progress}
            trackProgress={trackProgress}
          />

          <DeckControls
            hasChildren={hasChildren}
            isLoading={isLoading}
            isPlaying={isPlaying}
            onPlayPause={onPlayPause}
            onVolumeChange={onVolumeChange}
            volume={volume}
          />
        </div>

        {/* Children (Playlist/Tracks) - Scrollable if needed */}
        {children && (
          <div className="mt-4 flex-1 overflow-y-auto border-t pt-4">
            {children}
          </div>
        )}
      </div>

      {/* Footer Actions - Always at bottom */}
      <div className="mt-4 flex gap-2 border-t pt-4">
        {onChangeUrl && (
          <Button
            className="h-8 flex-1 text-xs"
            onClick={onChangeUrl}
            size="sm"
            variant="ghost"
          >
            <Link2 className="mr-2 size-3" />
            Change URL
          </Button>
        )}
        <Button
          className="h-8 flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
          onClick={onClear}
          size="sm"
          variant="ghost"
        >
          <X className="mr-2 size-3" />
          Eject
        </Button>
      </div>
    </div>
  );
}

function DeckInfo({
  hasChildren,
  artworkUrl,
  title,
  metadata,
  radio,
  artist,
}: {
  hasChildren: boolean;
  artworkUrl?: string;
  title: string;
  metadata: PlatformMetadata | null;
  radio: Radio;
  artist: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-4",
        !hasChildren && "w-full flex-col items-center gap-6"
      )}
    >
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-md border bg-muted transition-all duration-300",
          hasChildren ? "size-24" : "size-48 shadow-xl sm:size-56"
        )}
      >
        {artworkUrl ? (
          <img
            alt={title}
            className="h-full w-full object-contain"
            height={hasChildren ? 96 : 224}
            src={artworkUrl}
            width={hasChildren ? 96 : 224}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2
              className={cn(
                "text-muted-foreground/50",
                hasChildren ? "size-8" : "size-16"
              )}
            />
          </div>
        )}

        {metadata?.platform && (
          <div className="absolute right-0 bottom-0 left-0 bg-black/60 px-2 py-1 text-center font-medium text-[10px] text-white uppercase tracking-wider backdrop-blur-sm">
            {metadata.platform}
          </div>
        )}
      </div>

      <div
        className={cn(
          "min-w-0 flex-1 space-y-1",
          !hasChildren && "w-full px-4"
        )}
      >
        <h3
          className={cn(
            "truncate font-semibold leading-tight",
            hasChildren ? "text-lg" : "text-2xl"
          )}
          title={title}
        >
          {metadata ? title : <RadioNameLink radio={radio} />}
        </h3>
        <p
          className={cn(
            "truncate text-muted-foreground",
            hasChildren ? "text-sm" : "text-base"
          )}
          title={artist}
        >
          {artist}
        </p>

        {metadata?.url && (
          <a
            className="mt-1 inline-flex items-center gap-1 text-primary text-xs hover:underline"
            href={metadata.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open Link <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function DeckProgress({
  hasChildren,
  isLive,
  trackProgress,
  progress,
  formatTime,
  metadata,
}: {
  hasChildren: boolean;
  isLive: boolean;
  trackProgress: { position: number; duration: number } | undefined;
  progress: number;
  formatTime: (seconds: number) => string;
  metadata: PlatformMetadata | null;
}) {
  // Only show LIVE badge for non-platform items (regular radio streams)
  const shouldShowLive = isLive && !metadata?.platform;

  return (
    <div className={cn("w-full space-y-1.5", !hasChildren && "max-w-md")}>
      {shouldShowLive ? (
        <div className="flex items-center justify-center py-2">
          <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1 text-red-500">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            <span className="font-bold text-[10px] uppercase tracking-wider">
              Live
            </span>
          </div>
        </div>
      ) : (
        trackProgress &&
        trackProgress.duration > 0 && (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-100 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{formatTime(trackProgress.position)}</span>
              <span>{formatTime(trackProgress.duration)}</span>
            </div>
          </>
        )
      )}
    </div>
  );
}

function DeckControls({
  hasChildren,
  isLoading,
  isPlaying,
  onPlayPause,
  volume,
  onVolumeChange,
}: {
  hasChildren: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  volume: number;
  onVolumeChange: (value: number[]) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 pt-2",
        !hasChildren && "w-full max-w-md"
      )}
    >
      <PlayPauseButton
        className="size-10 shrink-0 rounded-full"
        disabled={isLoading}
        iconClassName="size-4"
        inline={true}
        isLoading={isLoading}
        isPlaying={isPlaying}
        onClick={onPlayPause}
        size="icon"
        variant={isPlaying ? "outline" : "default"}
      />

      <div className="flex-1 space-y-1">
        <div className="flex justify-between font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
          <span>Volume</span>
          <span>{Math.round(volume * 100)}%</span>
        </div>
        <Slider
          className="w-full"
          max={1}
          onValueChange={onVolumeChange}
          step={0.01}
          value={[volume]}
        />
      </div>
    </div>
  );
}
