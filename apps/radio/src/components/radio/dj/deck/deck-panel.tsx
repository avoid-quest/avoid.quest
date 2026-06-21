import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { isAudioFile } from "@/lib/audio/file-metadata";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import { getFilenameFromUrl } from "@/lib/audio/remote-url";
import { getDjDeckActions } from "@/lib/dj-actions";
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
import type { StaticAudioMetadata } from "@/lib/platform-types";
import {
  isDeviceInputMetadata,
  isFileMetadata,
  isYouTubeMetadata,
} from "@/lib/platform-types";
import {
  setDeckAPeakLevel,
  setDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import { DeviceForm } from "../device-form";
import { DjRadioList } from "../dj-radio-list";
import { ExternalSearch } from "../external-search";
import { FileForm } from "../file-form";
import { type DeckContextValue, DeckProvider } from "./deck-context";
import { DeviceInputContent } from "./deck-device-input-content";
import { DeckEmpty } from "./deck-empty";
import { DeckHeader } from "./deck-header";
import { LoadedDeckContent } from "./deck-loaded-content";
import {
  calculateHasTracklist,
  isStreamingMetadata,
  resolveYouTubePlaylistTrack,
} from "./deck-panel-helpers";

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
    loadTrack: loadDeckTrack,
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
  const deckActions = getDjDeckActions(deckId);

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
  const {
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffects,
    setChannelSelection,
    setDeviceSource,
    setFileSource,
  } = deckActions;

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
      setFileSource(file);
      setPendingPlatformItem(null);
    },
    [setFileSource]
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
      loadDeckTrack(deckSide, r, false);
      setPendingPlatformItem(null);
    },
    [deckSide, loadDeckTrack]
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
    loadDeckTrack(deckSide, null, false);
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
      const validation = validatePlaybackStreamUrl(resolvedUrl);
      if (!validation.ok) {
        toast.error("Invalid stream URL");
        return;
      }

      await loadDeckTrack(
        deckSide,
        { ...radio, streamUrl: validation.normalizedUrl },
        true
      );
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
    loadDeckTrack(deckSide, resolvedRadio, false);
    setPendingPlatformItem(null);
  };

  const handleLoadDeviceInput = async (
    deviceId: string,
    deviceLabel: string
  ) => {
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
      const editPlatform = radio.platformMetadata?.platform;
      const searchPlatform =
        editPlatform === "bandcamp" ||
        editPlatform === "soundcloud" ||
        editPlatform === "youtube" ||
        editPlatform === "radiogarden"
          ? editPlatform
          : ("all" as const);
      content = (
        <ExternalSearch
          initialPlatform={searchPlatform}
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
            onChannelSelectionChange={setChannelSelection}
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
          return;
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
  } else if (
    pendingPlatform === "external" ||
    pendingPlatform === "bandcamp" ||
    pendingPlatform === "soundcloud" ||
    pendingPlatform === "youtube" ||
    pendingPlatform === "radiogarden"
  ) {
    const searchPlatform =
      pendingPlatform === "external" ? "all" : pendingPlatform;
    content = (
      <ExternalSearch
        initialPlatform={searchPlatform}
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
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden px-1.5 pb-1.5 sm:px-2 sm:pb-2">
        {content}
      </div>
    </div>
  );
}
