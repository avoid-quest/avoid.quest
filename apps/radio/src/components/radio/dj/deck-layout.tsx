import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Slider } from "@avoid.quest/ui/components/slider";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileAudioIcon,
  Link2Icon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { EffectChain } from "@/components/audio/effect-chain";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import type { EffectConfig, EffectType, Radio } from "@/lib/audio";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import {
  type BandcampMetadata,
  isFileMetadata,
  type PlatformMetadata,
  type PlatformTrack,
  type SoundCloudMetadata,
  type YouTubeMetadata,
} from "@/lib/platform-types";
import { DeckTransportBar } from "./deck-transport-bar";
import { DeckPeakMeter } from "./peak-meter";

type DeckLayoutProps = {
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering?: boolean;
  isFileSource?: boolean;
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
  // Playback
  repeat?: boolean;
  autoplay?: boolean;
  // Deck identification
  deckId?: "deck-a" | "deck-b";
  // Deck side for peak meter positioning
  deckSide: "left" | "right";
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onPanChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
  onRepeatToggle?: () => void;
  onAutoplayToggle?: () => void;
  onClear: () => void;
  onChangeUrl?: () => void;
  onAddEffect?: (type: EffectType) => void;
  onUpdateEffect?: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect?: (effectId: string) => void;
  onReorderEffects?: (effectIds: string[]) => void;
  onPlayTrack?: (streamUrl: string) => void;
  onSeek?: (position: number) => void;
  className?: string;
};

function isStreamingMetadata(
  metadata?: PlatformMetadata
): metadata is BandcampMetadata | SoundCloudMetadata | YouTubeMetadata {
  return (
    metadata !== undefined &&
    metadata.platform !== "device-input" &&
    metadata.platform !== "local-file"
  );
}

function calculateHasTracklist(metadata?: PlatformMetadata): boolean {
  if (!isStreamingMetadata(metadata)) {
    return false;
  }
  return Boolean(
    ((metadata.platform === "bandcamp" && metadata.itemType === "album") ||
      (metadata.platform === "soundcloud" &&
        metadata.itemType === "playlist") ||
      (metadata.platform === "youtube" && metadata.itemType === "playlist")) &&
      metadata.tracks &&
      metadata.tracks.length > 0
  );
}

function getDisplayInfo(
  radio: Radio,
  metadata?: PlatformMetadata
): { artworkUrl?: string; title: string; artist: string } {
  if (isFileMetadata(metadata)) {
    return {
      artworkUrl: undefined,
      title: metadata.displayName || radio.name,
      artist: "Local File",
    };
  }
  if (!isStreamingMetadata(metadata)) {
    return { artworkUrl: radio.logoUrl, title: radio.name, artist: "Radio" };
  }
  const fallbackArtist: Record<string, string> = {
    soundcloud: "SoundCloud",
    youtube: "YouTube",
    bandcamp: "Bandcamp",
  };
  return {
    artworkUrl: metadata.artwork || radio.logoUrl,
    title: metadata.name || radio.name,
    artist: metadata.artist || fallbackArtist[metadata.platform] || "Radio",
  };
}

export function DeckLayout({
  radio,
  isPlaying,
  isLoading,
  isBuffering = false,
  isFileSource = false,
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
  repeat,
  autoplay,
  deckId,
  deckSide,
  onPlayPause,
  onVolumeChange,
  onPanChange,
  onSpeedChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
  onRepeatToggle,
  onAutoplayToggle,
  onClear,
  onChangeUrl,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  onPlayTrack,
  onSeek,
  className,
}: DeckLayoutProps) {
  const { artworkUrl, title } = getDisplayInfo(radio, metadata);
  const hasTracklist = calculateHasTracklist(metadata);
  const streamingMeta = isStreamingMetadata(metadata) ? metadata : null;
  const tracks = streamingMeta?.tracks;
  const isMobile = useIsMobile();

  // Resolve the effective stream URL for a track (YouTube tracks may need lazy resolution)
  const getTrackPlayUrl = (track: PlatformTrack): string => {
    if (track.streamUrl) {
      return track.streamUrl;
    }
    // YouTube tracks have videoId for lazy resolution
    if ("videoId" in track && track.videoId) {
      return `yt:${track.videoId}`;
    }
    return "";
  };

  // Tracklist navigation handlers
  const handleNextTrack = () => {
    if (hasTracklist && tracks && currentTrackIndex < tracks.length - 1) {
      const nextTrack = tracks[currentTrackIndex + 1];
      if (nextTrack) {
        onPlayTrack?.(getTrackPlayUrl(nextTrack));
      }
    }
  };

  const handlePreviousTrack = () => {
    if (hasTracklist && tracks && currentTrackIndex > 0) {
      const prevTrack = tracks[currentTrackIndex - 1];
      if (prevTrack) {
        onPlayTrack?.(getTrackPlayUrl(prevTrack));
      }
    }
  };

  // On mobile, wrap content in tabs
  if (isMobile) {
    return (
      <MobileDeckLayout
        artworkUrl={artworkUrl}
        autoplay={autoplay}
        channelFilter={channelFilter}
        className={className}
        currentTrackIndex={currentTrackIndex}
        deckId={deckId}
        effects={effects}
        effectsDryWet={effectsDryWet}
        hasTracklist={hasTracklist}
        isBuffering={isBuffering}
        isFileSource={isFileSource}
        isLoading={isLoading}
        isPlaying={isPlaying}
        metadata={metadata || null}
        onAddEffect={onAddEffect}
        onAutoplayToggle={onAutoplayToggle}
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
        onRepeatToggle={onRepeatToggle}
        onSeek={onSeek}
        onSpeedChange={onSpeedChange}
        onUpdateEffect={onUpdateEffect}
        onVolumeChange={onVolumeChange}
        pan={pan}
        repeat={repeat}
        speed={speed}
        title={title}
        trackProgress={trackProgress}
        volume={volume}
      />
    );
  }

  // Desktop layout with VU meters on inner edges (adjacent to mixer)
  return (
    <div className={cn("flex h-full min-h-0", className)}>
      {/* VU Meter on inner edge for Deck B (left side = inner) */}
      {deckSide === "right" && <DeckPeakMeter peakLevel={peakLevel} />}

      {/* Main deck content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2">
        {/* Transport Bar: artwork, play, track name, progress */}
        <DeckTransportBar
          artworkUrl={artworkUrl}
          autoplay={autoplay}
          hasTracklist={hasTracklist}
          isBuffering={isBuffering}
          isLoading={isLoading}
          isPlaying={isPlaying}
          onAutoplayToggle={onAutoplayToggle}
          onPlayPause={onPlayPause}
          onRepeatToggle={onRepeatToggle}
          onSeek={onSeek}
          repeat={repeat}
          title={title}
          trackProgress={trackProgress}
        />

        {/* Channel Strip — always visible */}
        <div className="rounded-lg border bg-muted/30 px-2 py-2">
          <ChannelStrip
            channelFilter={channelFilter}
            deckId={deckId}
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
        </div>

        {/* Scrollable content area for accordion sections */}
        <ScrollArea className="min-h-0 flex-1">
          <Accordion
            className="space-y-1"
            defaultValue={["effects"]}
            type="multiple"
          >
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
                    deckId={deckId}
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
          <DeckFooterActions
            isFileSource={isFileSource}
            onChangeUrl={onChangeUrl}
            onClear={onClear}
          />
        </div>
      </div>

      {/* VU Meter on inner edge for Deck A (right side = inner) */}
      {deckSide === "left" && <DeckPeakMeter peakLevel={peakLevel} />}
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

function DeckFooterActions({
  onChangeUrl,
  onClear,
  isFileSource = false,
}: {
  onChangeUrl?: () => void;
  onClear: () => void;
  isFileSource?: boolean;
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
          {isFileSource ? (
            <FileAudioIcon className="mr-1.5 size-3" />
          ) : (
            <Link2Icon className="mr-1.5 size-3" />
          )}
          {isFileSource ? "Change File" : "Change URL"}
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
  deckId?: "deck-a" | "deck-b";
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
  deckId,
  onVolumeChange,
  onPanChange,
  onChannelFilterChange,
  onSpeedChange,
  onEffectsDryWetChange,
}: ChannelStripProps) {
  const slider = (
    targetSuffix: string,
    props: Omit<ChannelSliderProps, "label"> & { label: string }
  ) => {
    const el = <ChannelSlider {...props} />;
    if (!deckId) {
      return el;
    }
    return (
      <MidiControlWrapper
        key={props.label}
        targetId={`${deckId}:${targetSuffix}`}
      >
        {el}
      </MidiControlWrapper>
    );
  };

  return (
    <div className="space-y-1.5">
      {slider("volume", {
        defaultValue: 1,
        formatValue: formatPercent,
        label: "VOL",
        max: 1.585,
        min: 0,
        onChange: onVolumeChange,
        step: 0.01,
        value: volume,
      })}
      {slider("pan", {
        defaultValue: 0,
        formatValue: formatPan,
        label: "PAN",
        max: 1,
        min: -1,
        onChange: onPanChange,
        step: 0.01,
        value: pan,
      })}
      {slider("filter", {
        defaultValue: 0,
        formatValue: formatChannelFilter,
        label: "FILT",
        max: 1,
        min: -1,
        onChange: onChannelFilterChange,
        step: 0.01,
        value: channelFilter,
      })}
      {slider("speed", {
        defaultValue: 1,
        formatValue: formatSpeed,
        label: "SPD",
        max: 2.0,
        min: 0.5,
        onChange: onSpeedChange,
        step: 0.01,
        value: speed,
      })}
      {slider("effects-drywet", {
        defaultValue: 0,
        formatValue: formatPercent,
        label: "FX",
        max: 1,
        min: 0,
        onChange: onEffectsDryWetChange,
        step: 0.01,
        value: effectsDryWet,
      })}
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
      <div className="min-w-0 flex-1" style={{ touchAction: "none" }}>
        <Slider
          defaultValue={defaultValue !== undefined ? [defaultValue] : undefined}
          max={max}
          min={min}
          onValueChange={([v]) => onChange(v)}
          step={step}
          value={[value]}
        />
      </div>
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
              key={
                track.streamUrl || ("videoId" in track ? track.videoId : index)
              }
              onClick={() =>
                onPlayTrack(
                  track.streamUrl ||
                    ("videoId" in track && track.videoId
                      ? `yt:${track.videoId}`
                      : "")
                )
              }
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
                  {formatPlatformDuration(track.duration)}
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
  isFileSource?: boolean;
  volume: number;
  trackProgress?: { position: number; duration: number };
  metadata: PlatformMetadata | null;
  currentTrackIndex: number;
  effects: EffectConfig[];
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  repeat?: boolean;
  autoplay?: boolean;
  deckId?: "deck-a" | "deck-b";
  hasTracklist: boolean;
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onPanChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
  onRepeatToggle?: () => void;
  onAutoplayToggle?: () => void;
  onClear: () => void;
  onChangeUrl?: () => void;
  onAddEffect?: (type: EffectType) => void;
  onUpdateEffect?: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect?: (effectId: string) => void;
  onReorderEffects?: (effectIds: string[]) => void;
  onPlayTrack?: (streamUrl: string) => void;
  onSeek?: (position: number) => void;
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
  isFileSource = false,
  volume,
  trackProgress,
  metadata,
  currentTrackIndex,
  effects,
  pan,
  channelFilter,
  speed,
  effectsDryWet,
  repeat,
  autoplay,
  deckId,
  hasTracklist,
  onPlayPause,
  onVolumeChange,
  onPanChange,
  onSpeedChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
  onRepeatToggle,
  onAutoplayToggle,
  onClear,
  onChangeUrl,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  onPlayTrack,
  onSeek,
  onNextTrack,
  onPreviousTrack,
  className,
}: MobileDeckLayoutProps) {
  const streamingMeta = metadata ?? undefined;
  const tracks = isStreamingMetadata(streamingMeta)
    ? streamingMeta.tracks
    : undefined;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 pr-3">
          {/* Transport Bar */}
          <DeckTransportBar
            artworkUrl={artworkUrl}
            autoplay={autoplay}
            hasTracklist={hasTracklist}
            isBuffering={isBuffering}
            isLoading={isLoading}
            isPlaying={isPlaying}
            onAutoplayToggle={onAutoplayToggle}
            onPlayPause={onPlayPause}
            onRepeatToggle={onRepeatToggle}
            onSeek={onSeek}
            repeat={repeat}
            title={title}
            trackProgress={trackProgress}
          />

          {/* Channel Strip — always visible */}
          <div className="rounded-lg border bg-muted/30 px-2 py-2">
            <ChannelStrip
              channelFilter={channelFilter}
              deckId={deckId}
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
          </div>

          <Accordion
            className="space-y-1"
            defaultValue={["effects"]}
            type="multiple"
          >
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

            {onAddEffect &&
              onUpdateEffect &&
              onRemoveEffect &&
              onReorderEffects && (
                <DeckSection
                  title={`Effects${effects.length > 0 ? ` (${effects.length})` : ""}`}
                  value="effects"
                >
                  <EffectChain
                    deckId={deckId}
                    effects={effects}
                    onAddEffect={onAddEffect}
                    onRemoveEffect={onRemoveEffect}
                    onReorderEffects={onReorderEffects}
                    onUpdateEffect={onUpdateEffect}
                  />
                </DeckSection>
              )}
          </Accordion>
        </div>
      </ScrollArea>

      {/* Footer Actions */}
      <DeckFooterActions
        isFileSource={isFileSource}
        onChangeUrl={onChangeUrl}
        onClear={onClear}
      />
    </div>
  );
}
