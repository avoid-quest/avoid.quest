import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { InfoIcon, MicIcon, MicOffIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EffectChain } from "@/components/audio/effect-chain";
import type { ChannelSelection, Radio } from "@/lib/audio";
import { isAudioFile } from "@/lib/audio/file-metadata";
import { getFilenameFromUrl } from "@/lib/audio/remote-url";
import {
  addDeckAEffect,
  addDeckBEffect,
  removeDeckAEffect,
  removeDeckBEffect,
  reorderDeckAEffects,
  reorderDeckBEffects,
  setDeckAChannelSelection,
  setDeckADeviceSource,
  setDeckAFileSource,
  setDeckBChannelSelection,
  setDeckBDeviceSource,
  setDeckBFileSource,
  updateDeckAEffect,
  updateDeckBEffect,
} from "@/lib/dj-actions";
import { isPlatformRadio } from "@/lib/external-url";
import { createPlatformRadio } from "@/lib/external-url/utils";
import { useDeckAState, useDeckBState } from "@/lib/hooks/use-deck-state";
import {
  setPendingPlatformItem,
  usePendingPlatformItem,
} from "@/lib/hooks/use-dj-state";
import { useMidiEffectRegistration } from "@/lib/hooks/use-midi-effect-registration";
import { usePeakLevel } from "@/lib/hooks/use-peak-level";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import type {
  BandcampMetadata,
  Platform,
  PlatformMetadata,
  SoundCloudMetadata,
  StaticAudioMetadata,
  YouTubeMetadata,
} from "@/lib/platform-types";
import {
  isDeviceInputMetadata,
  isFileMetadata,
  isYouTubeMetadata,
} from "@/lib/platform-types";
import {
  setDeckAPeakLevel,
  setDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import { youtubeResolveStream } from "@/utils/youtube.functions";
import { DeviceForm } from "../device-form";
import { DjRadioList } from "../dj-radio-list";
import { ExternalSearch } from "../external-search";
import { FileForm } from "../file-form";
import { PlatformForm } from "../platform-form";
import { DeckChannelStrip } from "./deck-channel-strip";
import {
  type DeckContextValue,
  DeckProvider,
  useDeckContext,
} from "./deck-context";
import { DeckEmpty } from "./deck-empty";
import { DeckFooter } from "./deck-footer";
import { DeckHeader } from "./deck-header";
import { DeckTracklist } from "./deck-tracklist";
import { DeckTransport } from "./deck-transport";

// ============================================================================
// Helpers
// ============================================================================

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
  const hasTracks = Boolean(metadata.tracks && metadata.tracks.length > 0);
  if (!hasTracks) {
    return false;
  }

  if (metadata.platform === "bandcamp") {
    return (
      metadata.itemType === "album" ||
      metadata.itemType === "artist" ||
      metadata.itemType === "collection"
    );
  }
  if (metadata.platform === "soundcloud") {
    return metadata.itemType === "playlist" || metadata.itemType === "user";
  }
  if (metadata.platform === "youtube") {
    return metadata.itemType === "playlist";
  }
  return false;
}

async function resolveYouTubePlaylistTrack(
  videoId: string,
  tracks?: { streamUrl: string; videoId?: string }[]
): Promise<string | null> {
  const result = await youtubeResolveStream({ data: { videoId } });
  const { stream } = result;
  if (!stream) {
    toast.error("Failed to resolve YouTube stream");
    return null;
  }
  if (tracks) {
    const track = tracks.find((t) => "videoId" in t && t.videoId === videoId);
    if (track) {
      track.streamUrl = stream.streamUrl;
    }
  }
  return stream.streamUrl;
}

// ============================================================================
// Entry point: DeckPanel renders A or B
// ============================================================================

type DeckPanelProps = {
  className?: string;
  deckId: "deck-a" | "deck-b";
  radios?: Radio[];
};

export function DeckPanel({ className, deckId, radios = [] }: DeckPanelProps) {
  if (deckId === "deck-a") {
    return <DeckPanelA className={className} radios={radios} />;
  }
  return <DeckPanelB className={className} radios={radios} />;
}

function DeckPanelA({
  className,
  radios,
}: {
  className?: string;
  radios: Radio[];
}) {
  const deckState = useDeckAState();
  return (
    <DeckPanelInner
      className={className}
      deckId="deck-a"
      deckState={deckState}
      radios={radios}
    />
  );
}

function DeckPanelB({
  className,
  radios,
}: {
  className?: string;
  radios: Radio[];
}) {
  const deckState = useDeckBState();
  return (
    <DeckPanelInner
      className={className}
      deckId="deck-b"
      deckState={deckState}
      radios={radios}
    />
  );
}

// ============================================================================
// DeckPanelInner — the main deck logic container
// ============================================================================

type DeckPanelInnerProps = {
  className?: string;
  deckId: "deck-a" | "deck-b";
  deckState: ReturnType<typeof useDeckAState>;
  radios: Radio[];
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: deck component handles multiple render states (empty, loading, device input, streaming, platform forms)
function DeckPanelInner({
  className,
  deckId,
  deckState,
  radios,
}: DeckPanelInnerProps) {
  const { isOver, setNodeRef } = useDroppable({ id: deckId });

  const {
    radio,
    isPlaying,
    isLoading,
    isBuffering,
    volume,
    play,
    pause,
    setVolume,
    loadTrack,
    soundId,
    reset,
    pan,
    speed,
    channelFilter,
    effectsDryWet,
    effects,
    repeat,
    autoplay,
    setPan,
    setSpeed,
    setChannelFilter,
    setEffectsDryWet,
    setRepeat,
    setAutoplay,
    seek,
  } = deckState;

  const { currentTrackIndex, metadata } = usePlatformMetadata(radio);
  const trackProgress = useTrackProgress(soundId);
  const peakLevel = usePeakLevel(soundId);

  // Publish peak levels to runtime store for mixer VU meters
  const setPeakLevel =
    deckId === "deck-a" ? setDeckAPeakLevel : setDeckBPeakLevel;
  useEffect(() => {
    setPeakLevel(peakLevel);
  }, [peakLevel, setPeakLevel]);

  // Throttle channel strip setters
  const throttledSetPan = useThrottledParam(setPan);
  const throttledSetSpeed = useThrottledParam(setSpeed);
  const throttledSetChannelFilter = useThrottledParam(setChannelFilter);
  const throttledSetEffectsDryWet = useThrottledParam(setEffectsDryWet);
  const throttledSetVolume = useThrottledParam(setVolume);

  // MIDI effect registration
  useMidiEffectRegistration(deckId, effects);

  // Effect actions
  const addEffect = deckId === "deck-a" ? addDeckAEffect : addDeckBEffect;
  const updateEffect =
    deckId === "deck-a" ? updateDeckAEffect : updateDeckBEffect;
  const removeEffect =
    deckId === "deck-a" ? removeDeckAEffect : removeDeckBEffect;
  const reorderEffects =
    deckId === "deck-a" ? reorderDeckAEffects : reorderDeckBEffects;

  const pendingPlatformItem = usePendingPlatformItem();
  const deckSide = deckId === "deck-a" ? "left" : "right";
  const [isChangingUrl, setIsChangingUrl] = useState(false);
  const [isChangingDevice, setIsChangingDevice] = useState(false);
  const [isChangingFile, setIsChangingFile] = useState(false);
  const isMobile = useIsMobile();

  const pendingPlatform =
    pendingPlatformItem?.deckId === deckId
      ? pendingPlatformItem.platform
      : undefined;

  const isDeviceInput = radio?.platformMetadata?.platform === "device-input";
  const isFileSource = isFileMetadata(radio?.platformMetadata);
  const effectiveMetadata = metadata || radio?.platformMetadata;
  const hasTracklist = calculateHasTracklist(effectiveMetadata);
  const streamingMeta = isStreamingMetadata(effectiveMetadata)
    ? effectiveMetadata
    : null;
  const tracks = streamingMeta?.tracks;

  const isSeekable =
    trackProgress?.duration != null &&
    Number.isFinite(trackProgress.duration) &&
    trackProgress.duration > 0;

  // File drag-and-drop
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDragCounter = useRef(0);

  const handleFileDrop = useCallback(
    (file: File) => {
      const setFileSource =
        deckId === "deck-a" ? setDeckAFileSource : setDeckBFileSource;
      setFileSource(file);
      setPendingPlatformItem(null);
    },
    [deckId]
  );

  const handleLoadRemoteUrl = useCallback(
    (url: string) => {
      const displayName = getFilenameFromUrl(url);
      const meta: StaticAudioMetadata = {
        platform: "static-audio",
        itemType: "track",
        url,
        fileName: displayName,
        displayName,
        duration: 0,
        fileSize: 0,
        mimeType: "audio/mpeg",
        streamUrl: url,
        isLocal: false,
        requiresProxy: false,
      };
      const r = createPlatformRadio(url, meta);
      loadTrack(deckSide, r, false);
      setPendingPlatformItem(null);
    },
    [deckSide, loadTrack]
  );

  // Native drag handlers
  const handleNativeDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleNativeDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    e.preventDefault();
    fileDragCounter.current += 1;
    setIsFileDragOver(true);
  }, []);

  const handleNativeDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    e.preventDefault();
    fileDragCounter.current -= 1;
    if (fileDragCounter.current <= 0) {
      fileDragCounter.current = 0;
      setIsFileDragOver(false);
    }
  }, []);

  const handleNativeDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      fileDragCounter.current = 0;
      setIsFileDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && isAudioFile(file)) {
        handleFileDrop(file);
      }
    },
    [handleFileDrop]
  );

  const handleClear = () => {
    loadTrack(deckSide, null, false);
    if (pendingPlatformItem?.deckId === deckId) {
      setPendingPlatformItem(null);
    }
  };

  const handleLoadTrack = async (streamUrl: string) => {
    if (!radio) {
      return;
    }
    let resolvedUrl: string = streamUrl;
    if (streamUrl.startsWith("yt:")) {
      const videoId = streamUrl.slice(3);
      const ytTracks = isYouTubeMetadata(metadata)
        ? metadata.tracks
        : undefined;
      const resolved = await resolveYouTubePlaylistTrack(videoId, ytTracks);
      if (!resolved) {
        return;
      }
      resolvedUrl = resolved;
    }
    if (resolvedUrl) {
      await loadTrack(deckSide, { ...radio, streamUrl: resolvedUrl }, true);
    }
  };

  const handleLoadPlatformItem = async (newRadio: Radio) => {
    let resolvedRadio = newRadio;
    if (newRadio.streamUrl.startsWith("yt:")) {
      const videoId = newRadio.streamUrl.slice(3);
      const ytTracks = isYouTubeMetadata(newRadio.platformMetadata)
        ? newRadio.platformMetadata.tracks
        : undefined;
      const resolvedUrl = await resolveYouTubePlaylistTrack(videoId, ytTracks);
      if (!resolvedUrl) {
        return;
      }
      resolvedRadio = { ...newRadio, streamUrl: resolvedUrl };
    }
    loadTrack(deckSide, resolvedRadio, false);
    setPendingPlatformItem(null);
  };

  const handleLoadDeviceInput = async (
    deviceId: string,
    deviceLabel: string
  ) => {
    const setDeviceSource =
      deckId === "deck-a" ? setDeckADeviceSource : setDeckBDeviceSource;
    await setDeviceSource(deviceId, deviceLabel);
    setPendingPlatformItem(null);
    setIsChangingDevice(false);
  };

  const handleUrlChanged = (newRadio: Radio) => {
    setIsChangingUrl(false);
    handleLoadPlatformItem(newRadio);
  };

  // Build the DeckContext value for child components
  const contextValue: DeckContextValue = {
    deckId,
    deckSide,
    radio,
    isPlaying,
    isLoading,
    isBuffering,
    volume,
    pan,
    speed,
    channelFilter,
    effectsDryWet,
    effects,
    repeat,
    autoplay,
    soundId,
    play,
    pause,
    setVolume: throttledSetVolume,
    setPan: throttledSetPan,
    setSpeed: throttledSetSpeed,
    setChannelFilter: throttledSetChannelFilter,
    setEffectsDryWet: throttledSetEffectsDryWet,
    setRepeat,
    setAutoplay,
    seek,
    loadTrack: handleLoadTrack,
    reset,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffects,
    trackProgress,
    peakLevel,
    metadata: effectiveMetadata,
    currentTrackIndex,
    hasTracklist,
    tracks,
    isFileSource,
    isSeekable,
  };

  // Determine which content to render
  let content: React.ReactNode;

  if (radio) {
    if (isChangingFile && isFileSource) {
      content = (
        <FileForm
          onCancel={() => setIsChangingFile(false)}
          onLoad={(file) => {
            setIsChangingFile(false);
            handleFileDrop(file);
          }}
          onLoadUrl={(url) => {
            setIsChangingFile(false);
            handleLoadRemoteUrl(url);
          }}
        />
      );
    } else if (isChangingUrl && isPlatformRadio(radio)) {
      content = (
        <PlatformForm
          currentUrl={radio.platformMetadata?.url}
          editMode={true}
          initialPlatform={radio.platformMetadata?.platform as Platform}
          onCancel={() => setIsChangingUrl(false)}
          onLoad={handleUrlChanged}
        />
      );
    } else if (isChangingDevice && isDeviceInput) {
      content = (
        <DeviceForm
          onCancel={() => setIsChangingDevice(false)}
          onLoad={handleLoadDeviceInput}
        />
      );
    } else if (isDeviceInputMetadata(radio?.platformMetadata)) {
      const deviceMeta = radio.platformMetadata;
      content = (
        <DeckProvider value={contextValue}>
          <DeviceInputContent
            channelCount={deviceMeta.channelCount ?? 2}
            channelSelection={
              deviceMeta.channelSelection ?? { left: 0, right: 1 }
            }
            deckId={deckId}
            deviceLabel={deviceMeta.deviceLabel ?? radio.name}
            isLoading={isLoading}
            isPlaying={isPlaying}
            onChangeDevice={() => setIsChangingDevice(true)}
            onChannelSelectionChange={
              deckId === "deck-a"
                ? setDeckAChannelSelection
                : setDeckBChannelSelection
            }
            onClear={handleClear}
            onToggleMute={() => {
              if (isPlaying) {
                pause();
              } else {
                play();
              }
            }}
          />
        </DeckProvider>
      );
    } else {
      // Normal deck (streaming/file)
      const onChangeUrl = (() => {
        if (!(radio && isPlatformRadio(radio))) {
          return undefined;
        }
        if (isFileSource) {
          return () => setIsChangingFile(true);
        }
        return () => setIsChangingUrl(true);
      })();

      content = (
        <DeckProvider value={contextValue}>
          <LoadedDeckContent onChangeUrl={onChangeUrl} onClear={handleClear} />
        </DeckProvider>
      );
    }
  } else if (pendingPlatform === "device-input") {
    content = (
      <DeviceForm onCancel={handleClear} onLoad={handleLoadDeviceInput} />
    );
  } else if (
    pendingPlatform === "local-file" ||
    pendingPlatform === "static-audio"
  ) {
    content = (
      <FileForm
        onCancel={handleClear}
        onLoad={handleFileDrop}
        onLoadUrl={handleLoadRemoteUrl}
      />
    );
  } else if (pendingPlatform === "external") {
    content = (
      <ExternalSearch onCancel={handleClear} onLoad={handleLoadPlatformItem} />
    );
  } else if (pendingPlatform) {
    content = (
      <PlatformForm
        initialPlatform={pendingPlatform}
        onCancel={handleClear}
        onLoad={handleLoadPlatformItem}
      />
    );
  } else if (isMobile) {
    content = (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <DjRadioList radios={radios} />
      </div>
    );
  } else {
    content = (
      <DeckEmpty
        addEffect={addEffect}
        effects={effects}
        onFileDrop={handleFileDrop}
        removeEffect={removeEffect}
        reorderEffects={reorderEffects}
        updateEffect={updateEffect}
      />
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: DnD drop zone for native file drag
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: DnD drop zone for native file drag
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-border/50 transition-colors",
        isOver ? "bg-primary/5" : "",
        isFileDragOver ? "bg-violet-500/5 ring-2 ring-violet-500/50" : "",
        className
      )}
      onDragEnter={handleNativeDragEnter}
      onDragLeave={handleNativeDragLeave}
      onDragOver={handleNativeDragOver}
      onDrop={handleNativeDrop}
      ref={setNodeRef}
    >
      <DeckHeader deckId={deckId} onReset={reset} radio={radio} />
      <div className="flex h-full min-h-0 flex-col px-1.5 pb-1.5 sm:px-2 sm:pb-2">
        {content}
      </div>
    </div>
  );
}

// ============================================================================
// LoadedDeckContent — normal streaming/file deck UI (uses DeckContext)
// ============================================================================

function LoadedDeckContent({
  onChangeUrl,
  onClear,
}: {
  onChangeUrl?: () => void;
  onClear: () => void;
}) {
  const {
    effects,
    deckId,
    isFileSource,
    hasTracklist,
    tracks,
    currentTrackIndex,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffects,
  } = useDeckContext();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1.5 pr-2 sm:gap-2 sm:pr-3">
            <DeckTransport />
            <div className="rounded-lg border border-border/50 bg-muted/30 px-2 py-2">
              <DeckChannelStrip />
            </div>
            <Accordion className="space-y-1" defaultValue={[]} type="multiple">
              {hasTracklist && tracks && (
                <AccordionSection
                  title={`Tracks (${currentTrackIndex + 1}/${tracks.length})`}
                  value="tracks"
                >
                  <DeckTracklist />
                </AccordionSection>
              )}
              <AccordionSection
                title={`Effects${effects.length > 0 ? ` (${effects.length})` : ""}`}
                value="effects"
              >
                <EffectChain
                  deckId={deckId}
                  effects={effects}
                  onAddEffect={addEffect}
                  onRemoveEffect={removeEffect}
                  onReorderEffects={reorderEffects}
                  onUpdateEffect={updateEffect}
                />
              </AccordionSection>
            </Accordion>
          </div>
        </ScrollArea>
        <DeckFooter
          isFileSource={isFileSource}
          onChangeUrl={onChangeUrl}
          onClear={onClear}
        />
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DeckTransport />
      <div className="rounded-lg border border-border/50 bg-muted/30 px-2 py-2">
        <DeckChannelStrip />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Accordion
          className="space-y-1"
          defaultValue={["effects"]}
          type="multiple"
        >
          {hasTracklist && tracks && (
            <AccordionSection
              title={`Tracks (${currentTrackIndex + 1}/${tracks.length})`}
              value="tracks"
            >
              <DeckTracklist />
            </AccordionSection>
          )}
          <AccordionSection
            title={`Effects${effects.length > 0 ? ` (${effects.length})` : ""}`}
            value="effects"
          >
            <EffectChain
              deckId={deckId}
              effects={effects}
              onAddEffect={addEffect}
              onRemoveEffect={removeEffect}
              onReorderEffects={reorderEffects}
              onUpdateEffect={updateEffect}
            />
          </AccordionSection>
        </Accordion>
      </ScrollArea>
      <div className="mt-auto">
        <DeckFooter
          isFileSource={isFileSource}
          onChangeUrl={onChangeUrl}
          onClear={onClear}
        />
      </div>
    </div>
  );
}

// ============================================================================
// DeviceInputContent — device input deck (uses DeckContext for channel strip)
// ============================================================================

function DeviceInputContent({
  deviceLabel,
  channelSelection,
  channelCount,
  isPlaying,
  isLoading,
  deckId,
  onToggleMute,
  onChannelSelectionChange,
  onChangeDevice,
  onClear,
}: {
  deviceLabel: string;
  channelSelection: ChannelSelection;
  channelCount: number;
  isPlaying: boolean;
  isLoading: boolean;
  deckId: "deck-a" | "deck-b";
  onToggleMute: () => void;
  onChannelSelectionChange: (selection: ChannelSelection) => void;
  onChangeDevice: () => void;
  onClear: () => void;
}) {
  const { effects, addEffect, updateEffect, removeEffect, reorderEffects } =
    useDeckContext();
  const isMobile = useIsMobile();

  const channelOptions = useMemo(
    () => buildChannelOptions(channelCount),
    [channelCount]
  );
  const selectedKey = serializeSelection(channelSelection);

  const sharedControls = (
    <>
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2">
        <MicIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-semibold text-sm">
          {deviceLabel}
        </span>
        <Badge
          className="shrink-0"
          variant={isPlaying ? "default" : "secondary"}
        >
          {isPlaying ? "LIVE" : "MUTED"}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex w-16 shrink-0 items-center gap-1 font-medium text-muted-foreground text-xs">
          Channel
          {channelCount <= 2 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="size-3 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-56" side="top">
                Browsers limit audio input to 2 channels per device. To route
                other channels, create an Aggregate Device in macOS Audio MIDI
                Setup or use virtual audio routing software.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <Select
          onValueChange={(v) =>
            onChannelSelectionChange(deserializeSelection(v))
          }
          value={selectedKey}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channelOptions.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        className="w-full"
        disabled={isLoading}
        onClick={onToggleMute}
        size="sm"
        variant={isPlaying ? "destructive" : "default"}
      >
        {isPlaying ? (
          <>
            <MicOffIcon className="mr-2 size-4" />
            Mute
          </>
        ) : (
          <>
            <MicIcon className="mr-2 size-4" />
            Go Live
          </>
        )}
      </Button>
      <DeckChannelStrip />
    </>
  );

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="source">Source</TabsTrigger>
            <TabsTrigger value="effects">Effects</TabsTrigger>
          </TabsList>
          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
            value="source"
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 pr-3">{sharedControls}</div>
            </ScrollArea>
          </TabsContent>
          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
            value="effects"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <EffectChain
                deckId={deckId}
                effects={effects}
                onAddEffect={addEffect}
                onRemoveEffect={removeEffect}
                onReorderEffects={reorderEffects}
                onUpdateEffect={updateEffect}
              />
            </div>
          </TabsContent>
        </Tabs>
        <DeckFooter
          isDeviceInput
          onChangeDevice={onChangeDevice}
          onClear={onClear}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 pr-3">
          {sharedControls}
          <EffectChain
            deckId={deckId}
            effects={effects}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
          />
        </div>
      </ScrollArea>
      <DeckFooter
        isDeviceInput
        onChangeDevice={onChangeDevice}
        onClear={onClear}
      />
    </div>
  );
}

// ============================================================================
// Shared sub-components
// ============================================================================

function AccordionSection({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem
      className="rounded-lg border border-border/50 bg-muted/30"
      value={value}
    >
      <AccordionTrigger className="px-2 py-2 font-medium text-xs hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent className="px-2 pb-2">{children}</AccordionContent>
    </AccordionItem>
  );
}

// Channel option helpers (from input-deck-layout.tsx)
type ChannelOption = {
  key: string;
  label: string;
  selection: ChannelSelection;
};

function serializeSelection(s: ChannelSelection): string {
  return `${s.left}:${s.right}`;
}

function deserializeSelection(key: string): ChannelSelection {
  const [left, right] = key.split(":").map(Number);
  return { left: left ?? 0, right: right ?? 1 };
}

function buildChannelOptions(channelCount: number): ChannelOption[] {
  const options: ChannelOption[] = [];
  for (let i = 0; i + 1 < channelCount; i += 2) {
    const selection = { left: i, right: i + 1 };
    options.push({
      key: serializeSelection(selection),
      label: `Ch ${i + 1}+${i + 2} (Stereo)`,
      selection,
    });
  }
  for (let i = 0; i < channelCount; i++) {
    const selection = { left: i, right: i };
    options.push({
      key: serializeSelection(selection),
      label: `Ch ${i + 1} (Mono)`,
      selection,
    });
  }
  return options;
}
