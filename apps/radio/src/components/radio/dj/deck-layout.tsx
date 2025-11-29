import { Button } from "@workspace/ui/components/button";
import { PlayPauseButton } from "@workspace/ui/components/play-pause-button";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Slider } from "@workspace/ui/components/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { ExternalLink, Link2, Music2, X } from "lucide-react";
import type { EffectConfig } from "@/lib/audio/effects/types";
import type { PlatformMetadata } from "@/lib/external-url/types";
import type { Radio } from "@/lib/types";
import { RadioNameLink } from "../radio-name-link";
import { DeckSections } from "./deck-sections";
import { PlaylistSnippet, PlaylistView } from "./playlist-view";

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

function calculateHasTracklist(metadata?: PlatformMetadata): boolean {
  return Boolean(
    metadata &&
      ((metadata.platform === "bandcamp" && metadata.itemType === "album") ||
        (metadata.platform === "soundcloud" &&
          metadata.itemType === "playlist")) &&
      metadata.tracks &&
      metadata.tracks.length > 0
  );
}

function calculateProgress(trackProgress?: {
  position: number;
  duration: number;
}): { isLive: boolean; progress: number } {
  const isLive =
    trackProgress?.duration === Number.POSITIVE_INFINITY ||
    trackProgress?.duration === 0 ||
    (trackProgress?.duration !== undefined &&
      !Number.isFinite(trackProgress.duration));

  const progress =
    !isLive && trackProgress?.duration
      ? (trackProgress.position / trackProgress.duration) * 100
      : 0;

  return { isLive, progress };
}

function getDisplayInfo(
  radio: Radio,
  metadata?: PlatformMetadata
): { artworkUrl?: string; title: string; artist: string } {
  return {
    artworkUrl: metadata?.artwork || radio.logoUrl,
    title: metadata?.name || radio.name,
    artist:
      metadata?.artist ||
      (metadata?.platform === "soundcloud" ? "SoundCloud" : "Radio"),
  };
}

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

  const { artworkUrl, title, artist } = getDisplayInfo(radio, metadata);
  const { isLive, progress } = calculateProgress(trackProgress);
  const hasTracklist = calculateHasTracklist(metadata);
  const isMobile = useIsMobile();

  // On mobile, wrap content in tabs to separate info/controls from effects
  if (isMobile) {
    return (
      <MobileDeckTabs
        artist={artist}
        artworkUrl={artworkUrl}
        className={className}
        currentTrackIndex={currentTrackIndex}
        effects={effects}
        formatTime={formatTime}
        hasTracklist={hasTracklist}
        isLive={isLive ?? false}
        isLoading={isLoading}
        isPlaying={isPlaying}
        metadata={metadata || null}
        onAddEffect={onAddEffect}
        onChangeUrl={onChangeUrl}
        onClear={onClear}
        onPlayPause={onPlayPause}
        onPlayTrack={onPlayTrack}
        onRemoveEffect={onRemoveEffect}
        onReorderEffects={onReorderEffects}
        onUpdateEffect={onUpdateEffect}
        onVolumeChange={onVolumeChange}
        progress={progress}
        radio={radio}
        title={title}
        trackProgress={trackProgress}
        volume={volume}
      />
    );
  }

  // Desktop layout: all in one view
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

        {/* Tracklist Snippet */}
        {hasTracklist && metadata?.tracks && onPlayTrack && (
          <PlaylistSnippet
            artist={metadata.artist}
            currentTrackIndex={currentTrackIndex}
            onPlayTrack={onPlayTrack}
            tracks={metadata.tracks}
          />
        )}

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
      <DeckFooterActions onChangeUrl={onChangeUrl} onClear={onClear} />
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

function DeckFooterActions({
  onChangeUrl,
  onClear,
}: {
  onChangeUrl?: () => void;
  onClear: () => void;
}) {
  return (
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
  );
}

type MobileDeckTabsProps = {
  artist: string;
  artworkUrl?: string;
  className?: string;
  currentTrackIndex: number;
  effects: EffectConfig[];
  formatTime: (seconds: number) => string;
  hasTracklist: boolean;
  isLoading: boolean;
  isLive: boolean;
  isPlaying: boolean;
  metadata: PlatformMetadata | null;
  onAddEffect?: (type: string) => void;
  onChangeUrl?: () => void;
  onClear: () => void;
  onPlayPause: () => void;
  onPlayTrack?: (streamUrl: string) => void;
  onRemoveEffect?: (effectId: string) => void;
  onReorderEffects?: (effectIds: string[]) => void;
  onUpdateEffect?: (effectId: string, config: Partial<EffectConfig>) => void;
  onVolumeChange: (value: number[]) => void;
  progress: number;
  radio: Radio;
  title: string;
  trackProgress?: {
    position: number;
    duration: number;
  };
  volume: number;
};

function MobileDeckTabs({
  artist,
  artworkUrl,
  className,
  currentTrackIndex,
  effects,
  formatTime,
  hasTracklist,
  isLoading,
  isLive,
  isPlaying,
  metadata,
  onAddEffect,
  onChangeUrl,
  onClear,
  onPlayPause,
  onPlayTrack,
  onRemoveEffect,
  onReorderEffects,
  onUpdateEffect,
  onVolumeChange,
  progress,
  radio,
  title,
  trackProgress,
  volume,
}: MobileDeckTabsProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
        <TabsList
          className={cn(
            "grid w-full",
            hasTracklist ? "grid-cols-3" : "grid-cols-2"
          )}
        >
          <TabsTrigger value="source">Source</TabsTrigger>
          {hasTracklist && (
            <TabsTrigger value="tracklist">Tracklist</TabsTrigger>
          )}
          <TabsTrigger value="effects">Effects</TabsTrigger>
        </TabsList>

        {/* Source Tab: Radio info + controls */}
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="source"
        >
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto">
            <DeckInfo
              artist={artist}
              artworkUrl={artworkUrl}
              metadata={metadata}
              radio={radio}
              title={title}
            />

            <DeckProgress
              formatTime={formatTime}
              isLive={isLive}
              metadata={metadata}
              progress={progress}
              trackProgress={trackProgress}
            />

            <DeckControls
              isLoading={isLoading}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onVolumeChange={onVolumeChange}
              volume={volume}
            />

            {/* Tracklist Snippet */}
            {hasTracklist && metadata?.tracks && onPlayTrack && (
              <PlaylistSnippet
                artist={metadata.artist}
                currentTrackIndex={currentTrackIndex}
                onPlayTrack={onPlayTrack}
                tracks={metadata.tracks}
              />
            )}
          </div>
        </TabsContent>

        {/* Tracklist Tab */}
        {hasTracklist && metadata?.tracks && onPlayTrack && (
          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
            value="tracklist"
          >
            <ScrollArea className="h-full min-h-0">
              <div className="w-full pr-4">
                <PlaylistView
                  artist={metadata.artist}
                  currentTrackIndex={currentTrackIndex}
                  onPlayTrack={onPlayTrack}
                  showFullList={true}
                  tracks={metadata.tracks}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        )}

        {/* Effects Tab: Effects only */}
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="effects"
        >
          {onAddEffect &&
            onUpdateEffect &&
            onRemoveEffect &&
            onReorderEffects &&
            onPlayTrack && (
              <DeckSections
                currentTrackIndex={currentTrackIndex}
                effects={effects}
                metadata={metadata}
                onAddEffect={onAddEffect}
                onPlayTrack={onPlayTrack}
                onRemoveEffect={onRemoveEffect}
                onReorderEffects={onReorderEffects}
                onUpdateEffect={onUpdateEffect}
              />
            )}
        </TabsContent>
      </Tabs>

      {/* Footer Actions - Always at bottom */}
      <DeckFooterActions onChangeUrl={onChangeUrl} onClear={onClear} />
    </div>
  );
}
