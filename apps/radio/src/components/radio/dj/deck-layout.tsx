import { Button } from "@workspace/ui/components/button";
import { PlayPauseButton } from "@workspace/ui/components/play-pause-button";
import { Progress } from "@workspace/ui/components/progress";
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
import { Link2Icon, Music2Icon, XIcon } from "lucide-react";
import type { EffectConfig, EffectType, Radio } from "@/lib/audio";
import type { PlatformMetadata } from "@/lib/platform-types";
import { RadioNameLink } from "../radio-name-link";
import { CollapsibleChannelStrip, CompactChannelStrip } from "./channel-strip";
import { DeckSections } from "./deck-sections";
import { PlaylistSnippet, PlaylistView } from "./playlist-view";

type DeckLayoutProps = {
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering?: boolean;
  volume: number;
  metadata?: PlatformMetadata;
  trackProgress?: {
    position: number;
    duration: number;
  };
  currentTrackIndex?: number;
  effects?: EffectConfig[];
  // Channel strip
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  peakLevel?: { left: number; right: number };
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onPanChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
  onClear: () => void;
  onChangeUrl?: () => void;
  onAddEffect?: (type: EffectType) => void;
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
}): number {
  // Calculate progress percentage for any track with a finite duration
  if (
    trackProgress?.duration &&
    Number.isFinite(trackProgress.duration) &&
    trackProgress.duration > 0
  ) {
    return (trackProgress.position / trackProgress.duration) * 100;
  }
  return 0;
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
  isBuffering = false,
  volume,
  metadata,
  trackProgress,
  currentTrackIndex = 0,
  effects = [],
  pan,
  speed,
  channelFilter,
  effectsDryWet,
  peakLevel,
  onPlayPause,
  onVolumeChange,
  onPanChange,
  onSpeedChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
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
  const progress = calculateProgress(trackProgress);
  const hasTracklist = calculateHasTracklist(metadata);
  const isMobile = useIsMobile();

  // Show LIVE badge for radios (no platform metadata) that have started playing
  const shouldShowLive = !metadata?.platform && Boolean(trackProgress);

  // On mobile, wrap content in tabs to separate info/controls from effects
  if (isMobile) {
    return (
      <MobileDeckTabs
        artist={artist}
        artworkUrl={artworkUrl}
        channelFilter={channelFilter}
        className={className}
        currentTrackIndex={currentTrackIndex}
        effects={effects}
        effectsDryWet={effectsDryWet}
        formatTime={formatTime}
        hasTracklist={hasTracklist}
        isBuffering={isBuffering}
        isLoading={isLoading}
        isPlaying={isPlaying}
        metadata={metadata || null}
        onAddEffect={onAddEffect}
        onChangeUrl={onChangeUrl}
        onChannelFilterChange={onChannelFilterChange}
        onClear={onClear}
        onEffectsDryWetChange={onEffectsDryWetChange}
        onPanChange={onPanChange}
        onPlayPause={onPlayPause}
        onPlayTrack={onPlayTrack}
        onRemoveEffect={onRemoveEffect}
        onReorderEffects={onReorderEffects}
        onSpeedChange={onSpeedChange}
        onUpdateEffect={onUpdateEffect}
        onVolumeChange={onVolumeChange}
        pan={pan}
        peakLevel={peakLevel}
        progress={progress}
        radio={radio}
        shouldShowLive={shouldShowLive}
        speed={speed}
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
          shouldShowLive={shouldShowLive}
          title={title}
        />

        {/* Progress Bar */}
        <DeckProgress
          formatTime={formatTime}
          progress={progress}
          trackProgress={trackProgress}
        />

        {/* Controls: Play/Pause + Volume */}
        <DeckControls
          isBuffering={isBuffering}
          isLoading={isLoading}
          isPlaying={isPlaying}
          onPlayPause={onPlayPause}
          onVolumeChange={onVolumeChange}
          volume={volume}
        />

        {/* Channel Strip: Pan, Speed, Filter, FX Dry/Wet */}
        <CollapsibleChannelStrip
          channelFilter={channelFilter}
          className="rounded-lg border bg-muted/30 p-3"
          defaultExpanded={false}
          effectsDryWet={effectsDryWet}
          onChannelFilterChange={onChannelFilterChange}
          onEffectsDryWetChange={onEffectsDryWetChange}
          onPanChange={onPanChange}
          onSpeedChange={onSpeedChange}
          onVolumeChange={(v) => onVolumeChange([v])}
          pan={pan}
          peakLevel={peakLevel}
          speed={speed}
          volume={volume}
        />

        {/* Tracklist Snippet */}
        {hasTracklist.valueOf() &&
          metadata?.tracks &&
          onPlayTrack?.valueOf() && (
            <PlaylistSnippet
              artist={metadata.artist}
              currentTrackIndex={currentTrackIndex}
              onPlayTrack={onPlayTrack}
              tracks={metadata.tracks}
            />
          )}

        {/* Deck Sections: Now Playing, Effects, Tracklist */}
        {onAddEffect?.valueOf() &&
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
  shouldShowLive,
}: {
  artworkUrl?: string;
  title: string;
  metadata: PlatformMetadata | null;
  radio: Radio;
  artist: string;
  shouldShowLive: boolean;
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
            <Music2Icon className="size-6 text-muted-foreground/50" />
          </div>
        )}

        {metadata?.platform?.valueOf() && (
          <div className="absolute right-0 bottom-0 left-0 bg-black/60 px-1 py-0.5 text-center font-medium text-[9px] text-white uppercase tracking-wider backdrop-blur-sm">
            {metadata.platform}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="truncate font-semibold text-base leading-tight"
            title={title}
          >
            {metadata ? title : <RadioNameLink radio={radio} />}
          </h3>
          {shouldShowLive ? (
            <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-red-500">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
              </span>
              <span className="font-bold text-[9px] uppercase tracking-wider">
                Live
              </span>
            </div>
          ) : null}
        </div>
        <p className="truncate text-muted-foreground text-sm" title={artist}>
          {artist}
        </p>
      </div>
    </div>
  );
}

function DeckProgress({
  trackProgress,
  progress,
  formatTime,
}: {
  trackProgress: { position: number; duration: number } | undefined;
  progress: number;
  formatTime: (seconds: number) => string;
}) {
  return (
    <div className="w-full space-y-1.5">
      {trackProgress?.valueOf() && trackProgress.duration > 0 && (
        <>
          <Progress className="h-1.5" value={progress} />
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{formatTime(trackProgress.position)}</span>
            <span>{formatTime(trackProgress.duration)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function DeckControls({
  isBuffering,
  isLoading,
  isPlaying,
  onPlayPause,
  volume,
  onVolumeChange,
}: {
  isBuffering: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  volume: number;
  onVolumeChange: (value: number[]) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <div className="relative">
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
        {/* Buffering indicator */}
        {isBuffering && isPlaying && (
          <div className="absolute -top-1 -right-1 flex items-center gap-1 rounded-full bg-amber-500/20 px-1.5 py-0.5">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-1">
        <div className="flex justify-between font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
          <span>{isBuffering && isPlaying ? "Buffering..." : "Volume"}</span>
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
      {onChangeUrl?.valueOf() && (
        <Button
          className="h-7 flex-1 text-xs"
          onClick={onChangeUrl}
          size="sm"
          variant="ghost"
        >
          <Link2Icon className="mr-1.5 size-3" />
          Change URL
        </Button>
      )}
      <Button
        className="h-7 flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
        onClick={onClear}
        size="sm"
        variant="ghost"
      >
        <XIcon className="mr-1.5 size-3" />
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
  isBuffering: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  metadata: PlatformMetadata | null;
  // Channel strip
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  peakLevel?: { left: number; right: number };
  onAddEffect?: (type: EffectType) => void;
  onChangeUrl?: () => void;
  onClear: () => void;
  onPlayPause: () => void;
  onPlayTrack?: (streamUrl: string) => void;
  onRemoveEffect?: (effectId: string) => void;
  onReorderEffects?: (effectIds: string[]) => void;
  onUpdateEffect?: (effectId: string, config: Partial<EffectConfig>) => void;
  onVolumeChange: (value: number[]) => void;
  onPanChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
  progress: number;
  radio: Radio;
  shouldShowLive: boolean;
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
  isBuffering,
  isLoading,
  isPlaying,
  metadata,
  pan,
  speed: _speed, // Not used in compact mobile strip
  channelFilter: _channelFilter, // Not used in compact mobile strip
  effectsDryWet,
  peakLevel,
  onAddEffect,
  onChangeUrl,
  onClear,
  onPlayPause,
  onPlayTrack,
  onRemoveEffect,
  onReorderEffects,
  onUpdateEffect,
  onVolumeChange,
  onPanChange,
  onSpeedChange: _onSpeedChange, // Not used in compact mobile strip
  onChannelFilterChange: _onChannelFilterChange, // Not used in compact mobile strip
  onEffectsDryWetChange,
  progress,
  radio,
  shouldShowLive,
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
          {hasTracklist.valueOf() && (
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
              shouldShowLive={shouldShowLive}
              title={title}
            />

            <DeckProgress
              formatTime={formatTime}
              progress={progress}
              trackProgress={trackProgress}
            />

            <DeckControls
              isBuffering={isBuffering}
              isLoading={isLoading}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onVolumeChange={onVolumeChange}
              volume={volume}
            />

            {/* Compact Channel Strip for mobile */}
            <CompactChannelStrip
              className="rounded-lg border bg-muted/30 p-2"
              effectsDryWet={effectsDryWet}
              onEffectsDryWetChange={onEffectsDryWetChange}
              onPanChange={onPanChange}
              onVolumeChange={(v) => onVolumeChange([v])}
              pan={pan}
              peakLevel={peakLevel}
              volume={volume}
            />

            {/* Tracklist Snippet */}
            {hasTracklist.valueOf() &&
              metadata?.tracks &&
              onPlayTrack?.valueOf() && (
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
        {hasTracklist.valueOf() &&
          metadata?.tracks &&
          onPlayTrack?.valueOf() && (
            <TabsContent
              className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
              value="tracklist"
            >
              <ScrollArea className="h-full min-h-0">
                <div className="w-full pr-4">
                  <PlaylistView
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
          {onAddEffect?.valueOf() &&
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
