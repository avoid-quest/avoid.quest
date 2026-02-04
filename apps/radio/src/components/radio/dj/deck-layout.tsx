import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Slider } from "@avoid.quest/ui/components/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Link2Icon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { EffectChain } from "@/components/audio/effect-chain";
import type { EffectConfig, EffectType, Radio } from "@/lib/audio";
import type {
  BandcampMetadata,
  PlatformMetadata,
  PlatformTrack,
  SoundCloudMetadata,
} from "@/lib/platform-types";
import { DeckTransportBar } from "./deck-transport-bar";
import { DeckPeakMeter } from "./peak-meter";

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
  // Deck side for peak meter positioning
  deckSide: "left" | "right";
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

function isStreamingMetadata(
  metadata?: PlatformMetadata
): metadata is BandcampMetadata | SoundCloudMetadata {
  return metadata !== undefined && metadata.platform !== "device-input";
}

function calculateHasTracklist(metadata?: PlatformMetadata): boolean {
  if (!isStreamingMetadata(metadata)) {
    return false;
  }
  return Boolean(
    ((metadata.platform === "bandcamp" && metadata.itemType === "album") ||
      (metadata.platform === "soundcloud" &&
        metadata.itemType === "playlist")) &&
      metadata.tracks &&
      metadata.tracks.length > 0
  );
}

function getDisplayInfo(
  radio: Radio,
  metadata?: PlatformMetadata
): { artworkUrl?: string; title: string; artist: string } {
  if (!isStreamingMetadata(metadata)) {
    return { title: radio.name, artist: "Radio" };
  }
  return {
    artworkUrl: metadata.artwork || radio.logoUrl,
    title: metadata.name || radio.name,
    artist:
      metadata.artist ||
      (metadata.platform === "soundcloud" ? "SoundCloud" : "Radio"),
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
  deckSide,
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
  const { artworkUrl, title } = getDisplayInfo(radio, metadata);
  const hasTracklist = calculateHasTracklist(metadata);
  const streamingMeta = isStreamingMetadata(metadata) ? metadata : null;
  const tracks = streamingMeta?.tracks;
  const isMobile = useIsMobile();

  // Tracklist navigation handlers
  const handleNextTrack = () => {
    if (hasTracklist && tracks && currentTrackIndex < tracks.length - 1) {
      const nextTrack = tracks[currentTrackIndex + 1];
      if (nextTrack) {
        onPlayTrack?.(nextTrack.streamUrl);
      }
    }
  };

  const handlePreviousTrack = () => {
    if (hasTracklist && tracks && currentTrackIndex > 0) {
      const prevTrack = tracks[currentTrackIndex - 1];
      if (prevTrack) {
        onPlayTrack?.(prevTrack.streamUrl);
      }
    }
  };

  // On mobile, wrap content in tabs
  if (isMobile) {
    return (
      <MobileDeckLayout
        artworkUrl={artworkUrl}
        channelFilter={channelFilter}
        className={className}
        currentTrackIndex={currentTrackIndex}
        effects={effects}
        effectsDryWet={effectsDryWet}
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
        onNextTrack={handleNextTrack}
        onPanChange={onPanChange}
        onPlayPause={onPlayPause}
        onPlayTrack={onPlayTrack}
        onPreviousTrack={handlePreviousTrack}
        onRemoveEffect={onRemoveEffect}
        onReorderEffects={onReorderEffects}
        onSpeedChange={onSpeedChange}
        onUpdateEffect={onUpdateEffect}
        onVolumeChange={onVolumeChange}
        pan={pan}
        speed={speed}
        title={title}
        trackProgress={trackProgress}
        volume={volume}
      />
    );
  }

  // Desktop layout with full-height VU meters on external edges
  return (
    <div className={cn("flex h-full min-h-0", className)}>
      {/* VU Meter on left edge for Deck A (external edge) */}
      {deckSide === "left" && <DeckPeakMeter peakLevel={peakLevel} />}

      {/* Main deck content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2">
        {/* Transport Bar: artwork, play, track name, progress */}
        <DeckTransportBar
          artworkUrl={artworkUrl}
          isBuffering={isBuffering}
          isLoading={isLoading}
          isPlaying={isPlaying}
          onPlayPause={onPlayPause}
          title={title}
          trackProgress={trackProgress}
        />

        {/* Scrollable content area for accordion sections */}
        <ScrollArea className="min-h-0 flex-1">
          <Accordion
            className="space-y-1"
            defaultValue={["channel-strip"]}
            type="multiple"
          >
            <DeckSection title="Channel Strip" value="channel-strip">
              <ChannelStrip
                channelFilter={channelFilter}
                effectsDryWet={effectsDryWet}
                onChannelFilterChange={onChannelFilterChange}
                onEffectsDryWetChange={onEffectsDryWetChange}
                onPanChange={onPanChange}
                onSpeedChange={onSpeedChange}
                onVolumeChange={(v) => onVolumeChange([v])}
                pan={pan}
                speed={speed}
                volume={volume}
              />
            </DeckSection>

            {hasTracklist && tracks && onPlayTrack && (
              <DeckSection
                title={`Tracks (${currentTrackIndex + 1}/${tracks.length})`}
                value="tracks"
              >
                <TracklistContent
                  currentTrackIndex={currentTrackIndex}
                  onNext={handleNextTrack}
                  onPlayTrack={onPlayTrack}
                  onPrevious={handlePreviousTrack}
                  tracks={tracks}
                />
              </DeckSection>
            )}

            {onAddEffect &&
              onUpdateEffect &&
              onRemoveEffect &&
              onReorderEffects && (
                <DeckSection
                  title={`Effects${effects.length > 0 ? ` (${effects.length})` : ""}`}
                  value="effects"
                >
                  <EffectChain
                    effects={effects}
                    onAddEffect={onAddEffect}
                    onRemoveEffect={onRemoveEffect}
                    onReorderEffects={onReorderEffects}
                    onUpdateEffect={onUpdateEffect}
                  />
                </DeckSection>
              )}
          </Accordion>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="mt-auto">
          <DeckFooterActions onChangeUrl={onChangeUrl} onClear={onClear} />
        </div>
      </div>

      {/* VU Meter on right edge for Deck B (external edge) */}
      {deckSide === "right" && <DeckPeakMeter peakLevel={peakLevel} />}
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

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

// ============================================================================
// Shared Accordion Section Component
// ============================================================================

type DeckSectionProps = {
  value: string;
  title: string;
  children: React.ReactNode;
};

function DeckSection({ value, title, children }: DeckSectionProps) {
  return (
    <AccordionItem className="rounded-lg border bg-muted/30" value={value}>
      <AccordionTrigger className="px-2 py-2 font-medium text-xs hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent className="px-2 pb-2">{children}</AccordionContent>
    </AccordionItem>
  );
}

// ============================================================================
// Channel Strip
// ============================================================================

type ChannelStripProps = {
  volume: number;
  pan: number;
  channelFilter: number;
  speed: number;
  effectsDryWet: number;
  onVolumeChange: (value: number) => void;
  onPanChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
};

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.05) {
    return "C";
  }
  const percent = Math.abs(Math.round(pan * 100));
  return pan < 0 ? `L${percent}` : `R${percent}`;
}

function formatChannelFilter(value: number): string {
  if (Math.abs(value) < 0.05) {
    return "OFF";
  }
  return value < 0
    ? `LP ${Math.round(Math.abs(value) * 100)}%`
    : `HP ${Math.round(value * 100)}%`;
}

function formatSpeed(speed: number): string {
  return `${speed.toFixed(2)}x`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ChannelStrip({
  volume,
  pan,
  channelFilter,
  speed,
  effectsDryWet,
  onVolumeChange,
  onPanChange,
  onChannelFilterChange,
  onSpeedChange,
  onEffectsDryWetChange,
}: ChannelStripProps) {
  return (
    <div className="space-y-1.5">
      <ChannelSlider
        defaultValue={1}
        formatValue={formatPercent}
        label="VOL"
        max={1.585}
        min={0}
        onChange={onVolumeChange}
        step={0.01}
        value={volume}
      />
      <ChannelSlider
        defaultValue={0}
        formatValue={formatPan}
        label="PAN"
        max={1}
        min={-1}
        onChange={onPanChange}
        step={0.01}
        value={pan}
      />
      <ChannelSlider
        defaultValue={0}
        formatValue={formatChannelFilter}
        label="FILT"
        max={1}
        min={-1}
        onChange={onChannelFilterChange}
        step={0.01}
        value={channelFilter}
      />
      <ChannelSlider
        defaultValue={1}
        formatValue={formatSpeed}
        label="SPD"
        max={2.0}
        min={0.5}
        onChange={onSpeedChange}
        step={0.01}
        value={speed}
      />
      <ChannelSlider
        defaultValue={0}
        formatValue={formatPercent}
        label="FX"
        max={1}
        min={0}
        onChange={onEffectsDryWetChange}
        step={0.01}
        value={effectsDryWet}
      />
    </div>
  );
}

type ChannelSliderProps = {
  label: string;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
};

function ChannelSlider({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
  formatValue,
}: ChannelSliderProps) {
  return (
    <div className="flex h-7 items-center gap-2">
      <span className="w-8 shrink-0 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <Slider
        className="min-w-0 flex-1"
        defaultValue={defaultValue !== undefined ? [defaultValue] : undefined}
        max={max}
        min={min}
        onValueChange={([v]) => onChange(v)}
        step={step}
        value={[value]}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {formatValue(value)}
      </span>
    </div>
  );
}

// ============================================================================
// Tracklist Content (for accordion)
// ============================================================================

type TracklistContentProps = {
  tracks: PlatformTrack[];
  currentTrackIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onPlayTrack: (streamUrl: string) => void;
};

function formatDuration(seconds?: number): string {
  if (!seconds) {
    return "";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function TracklistContent({
  tracks,
  currentTrackIndex,
  onPrevious,
  onNext,
  onPlayTrack,
}: TracklistContentProps) {
  const hasNext = currentTrackIndex < tracks.length - 1;
  const hasPrevious = currentTrackIndex > 0;

  if (tracks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {/* Navigation row */}
      <div className="flex items-center gap-1">
        <Button
          aria-label="Previous track"
          className="h-6 w-6 p-0"
          disabled={!hasPrevious}
          onClick={onPrevious}
          size="sm"
          variant="ghost"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>

        <Button
          aria-label="Next track"
          className="h-6 w-6 p-0"
          disabled={!hasNext}
          onClick={onNext}
          size="sm"
          variant="ghost"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {/* Track list */}
      <ScrollArea className="h-40 rounded-md border">
        <div className="space-y-0.5 p-1.5">
          {tracks.map((track, index) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50",
                index === currentTrackIndex && "bg-primary/10"
              )}
              key={track.streamUrl || index}
              onClick={() => onPlayTrack(track.streamUrl)}
              type="button"
            >
              <div className="flex size-5 shrink-0 items-center justify-center">
                {index === currentTrackIndex ? (
                  <PlayIcon className="size-3 text-primary" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-xs">{track.name}</div>
              </div>
              {track.duration && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatDuration(track.duration)}
                </span>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Mobile Layout
// ============================================================================

type MobileDeckLayoutProps = {
  title: string;
  artworkUrl?: string;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  volume: number;
  trackProgress?: { position: number; duration: number };
  metadata: PlatformMetadata | null;
  currentTrackIndex: number;
  effects: EffectConfig[];
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  hasTracklist: boolean;
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
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  className?: string;
};

function MobileDeckLayout({
  title,
  artworkUrl,
  isPlaying,
  isLoading,
  isBuffering,
  volume,
  trackProgress,
  metadata,
  currentTrackIndex,
  effects,
  pan,
  channelFilter,
  speed,
  effectsDryWet,
  hasTracklist,
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
  onNextTrack,
  onPreviousTrack,
  className,
}: MobileDeckLayoutProps) {
  const tracks = isStreamingMetadata(metadata ?? undefined)
    ? metadata.tracks
    : undefined;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="effects">Effects</TabsTrigger>
        </TabsList>

        {/* Source Tab */}
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
          value="source"
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 pr-3">
              {/* Transport Bar */}
              <DeckTransportBar
                artworkUrl={artworkUrl}
                isBuffering={isBuffering}
                isLoading={isLoading}
                isPlaying={isPlaying}
                onPlayPause={onPlayPause}
                title={title}
                trackProgress={trackProgress}
              />

              <Accordion
                className="space-y-1"
                defaultValue={["channel-strip"]}
                type="multiple"
              >
                <DeckSection title="Channel Strip" value="channel-strip">
                  <ChannelStrip
                    channelFilter={channelFilter}
                    effectsDryWet={effectsDryWet}
                    onChannelFilterChange={onChannelFilterChange}
                    onEffectsDryWetChange={onEffectsDryWetChange}
                    onPanChange={onPanChange}
                    onSpeedChange={onSpeedChange}
                    onVolumeChange={(v) => onVolumeChange([v])}
                    pan={pan}
                    speed={speed}
                    volume={volume}
                  />
                </DeckSection>

                {hasTracklist && tracks && onPlayTrack && (
                  <DeckSection
                    title={`Tracks (${currentTrackIndex + 1}/${tracks.length})`}
                    value="tracks"
                  >
                    <TracklistContent
                      currentTrackIndex={currentTrackIndex}
                      onNext={onNextTrack}
                      onPlayTrack={onPlayTrack}
                      onPrevious={onPreviousTrack}
                      tracks={tracks}
                    />
                  </DeckSection>
                )}
              </Accordion>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Effects Tab */}
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="effects"
        >
          {onAddEffect &&
            onUpdateEffect &&
            onRemoveEffect &&
            onReorderEffects && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <EffectChain
                  effects={effects}
                  onAddEffect={onAddEffect}
                  onRemoveEffect={onRemoveEffect}
                  onReorderEffects={onReorderEffects}
                  onUpdateEffect={onUpdateEffect}
                />
              </div>
            )}
        </TabsContent>
      </Tabs>

      {/* Footer Actions */}
      <DeckFooterActions onChangeUrl={onChangeUrl} onClear={onClear} />
    </div>
  );
}
