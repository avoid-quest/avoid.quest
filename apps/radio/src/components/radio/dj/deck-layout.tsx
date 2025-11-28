import { Button } from "@workspace/ui/components/button";
import { PlayPauseButton } from "@workspace/ui/components/play-pause-button";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { ExternalLink, Link2, Music2, X } from "lucide-react";
import type { EffectConfig } from "@/lib/audio/effects/types";
import type { PlatformMetadata } from "@/lib/external-url/types";
import type { Radio } from "@/lib/types";
import { RadioNameLink } from "../radio-name-link";
import { DeckSections } from "./deck-sections";

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
  currentTrackIndex?: number;
  effects?: EffectConfig[];
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onClear: () => void;
  onChangeUrl?: () => void;
  onAddEffect?: (type: string) => void;
  onUpdateEffect?: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect?: (effectId: string) => void;
  onReorderEffects?: (effectIds: string[]) => void;
  onPlayTrack?: (streamUrl: string) => void;
  className?: string;
};

export function DeckLayout({
  radio,
  isPlaying,
  isLoading,
  volume,
  metadata,
  trackProgress,
  currentTrackIndex = 0,
  effects = [],
  onPlayPause,
  onVolumeChange,
  onClear,
  onChangeUrl,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  onPlayTrack,
  className,
}: DeckLayoutProps) {
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

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* Main Content Area - Pushes footer down */}
      <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden">
        {/* Top Section: Compact Item Info */}
        <DeckInfo
          artist={artist}
          artworkUrl={artworkUrl}
          metadata={metadata || null}
          radio={radio}
          title={title}
        />

        {/* Progress Bar */}
        <DeckProgress
          formatTime={formatTime}
          isLive={isLive ?? false}
          metadata={metadata ?? null}
          progress={progress}
          trackProgress={trackProgress}
        />

        {/* Controls: Play/Pause + Volume */}
        <DeckControls
          isLoading={isLoading}
          isPlaying={isPlaying}
          onPlayPause={onPlayPause}
          onVolumeChange={onVolumeChange}
          volume={volume}
        />

        {/* Deck Sections: Now Playing, Effects, Tracklist */}
        {onAddEffect &&
          onUpdateEffect &&
          onRemoveEffect &&
          onReorderEffects &&
          onPlayTrack && (
            <div className="flex min-h-0 flex-1 flex-col border-t pt-3">
              <DeckSections
                currentTrackIndex={currentTrackIndex}
                effects={effects}
                metadata={metadata || null}
                onAddEffect={onAddEffect}
                onPlayTrack={onPlayTrack}
                onRemoveEffect={onRemoveEffect}
                onReorderEffects={onReorderEffects}
                onUpdateEffect={onUpdateEffect}
              />
            </div>
          )}
      </div>

      {/* Footer Actions - Always at bottom */}
      <div className="flex gap-1 border-t pt-1.5">
        {onChangeUrl && (
          <Button
            className="h-7 flex-1 text-xs"
            onClick={onChangeUrl}
            size="sm"
            variant="ghost"
          >
            <Link2 className="mr-1.5 size-3" />
            Change URL
          </Button>
        )}
        <Button
          className="h-7 flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
          onClick={onClear}
          size="sm"
          variant="ghost"
        >
          <X className="mr-1.5 size-3" />
          Eject
        </Button>
      </div>
    </div>
  );
}

function DeckInfo({
  artworkUrl,
  title,
  metadata,
  radio,
  artist,
}: {
  artworkUrl?: string;
  title: string;
  metadata: PlatformMetadata | null;
  radio: Radio;
  artist: string;
}) {
  return (
    <div className="flex w-full items-start gap-3">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted">
        {artworkUrl ? (
          <img
            alt={title}
            className="h-full w-full object-contain"
            height={64}
            src={artworkUrl}
            width={64}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2 className="size-6 text-muted-foreground/50" />
          </div>
        )}

        {metadata?.platform && (
          <div className="absolute right-0 bottom-0 left-0 bg-black/60 px-1 py-0.5 text-center font-medium text-[9px] text-white uppercase tracking-wider backdrop-blur-sm">
            {metadata.platform}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <h3
          className="truncate font-semibold text-base leading-tight"
          title={title}
        >
          {metadata ? title : <RadioNameLink radio={radio} />}
        </h3>
        <p className="truncate text-muted-foreground text-sm" title={artist}>
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
  isLive,
  trackProgress,
  progress,
  formatTime,
  metadata,
}: {
  isLive: boolean;
  trackProgress: { position: number; duration: number } | undefined;
  progress: number;
  formatTime: (seconds: number) => string;
  metadata: PlatformMetadata | null;
}) {
  // Only show LIVE badge for non-platform items (regular radio streams)
  const shouldShowLive = isLive && !metadata?.platform;

  return (
    <div className="w-full space-y-1.5">
      {shouldShowLive ? (
        <div className="flex items-center justify-center py-1">
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
  isLoading,
  isPlaying,
  onPlayPause,
  volume,
  onVolumeChange,
}: {
  isLoading: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  volume: number;
  onVolumeChange: (value: number[]) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3">
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
