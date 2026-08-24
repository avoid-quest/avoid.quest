import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { isAudioFile } from "@/lib/audio/file-metadata";
import { channelEffects } from "@/lib/channel-effects";
import { getDjDeckActions } from "@/lib/dj-actions";
import { isPlatformRadio } from "@/lib/external-url";
import { useDeckAState, useDeckBState } from "@/lib/hooks/use-deck-state";
import { useDjSession } from "@/lib/hooks/use-dj-session";
import {
  setPendingPlatformItem,
  usePendingPlatformItem,
} from "@/lib/hooks/use-dj-state";
import { useMidiEffectRegistration } from "@/lib/hooks/use-midi-effect-registration";
import { usePeakLevel } from "@/lib/hooks/use-peak-level";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import {
  isDeviceInputMetadata,
  isFileMetadata,
  isStaticAudioMetadata,
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
  resolveDeckPanelContentKind,
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
    loadSource,
  } = deckState;
  const deckActions = getDjDeckActions(deckId);
  const djSession = useDjSession();
  const effectsTempo = djSession?.tempo ?? 120;

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
  const isFileSource =
    isFileMetadata(radio?.platformMetadata) ||
    isStaticAudioMetadata(radio?.platformMetadata);
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
      loadSource({ type: "file", file }).catch((error) => {
        console.error("[dj] Failed to load file source:", error);
      });
      setPendingPlatformItem(null);
    },
    [loadSource]
  );

  const handleLoadRemoteUrl = useCallback(
    (url: string) => {
      loadSource({ type: "static-audio-url", url }).catch((error) => {
        console.error("[dj] Failed to load static audio URL:", error);
      });
      setPendingPlatformItem(null);
    },
    [loadSource]
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
    loadSource({ type: "track", radio: null, autoPlay: false }).catch(
      (error) => {
        console.error("[dj] Failed to clear deck source:", error);
      }
    );
    if (pendingPlatformItem?.deckId === deckId) {
      setPendingPlatformItem(null);
    }
  };

  const handleCancelPendingSource = () => {
    setPendingPlatformItem(null);
  };

  const handleLoadTrack = async (streamUrl: string) => {
    if (!radio) {
      return;
    }
    await loadSource({ type: "track-url", radio, streamUrl, autoPlay: true });
  };

  const handleLoadPlatformItem = async (newRadio: Radio) => {
    await loadSource({ type: "track", radio: newRadio, autoPlay: false });
    setPendingPlatformItem(null);
  };

  const handleLoadDeviceInput = async (
    deviceId: string,
    deviceLabel: string
  ) => {
    await loadSource({ type: "device-input", deviceId, deviceLabel });
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
    effectsTempo,
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
    setEffectsTempo: (tempo) => {
      channelEffects
        .setTempo("dj", tempo)
        .catch((error: unknown) =>
          console.warn(
            "[ChannelEffects] Could not reconcile Channel Effects",
            error
          )
        );
    },
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
  const contentKind = resolveDeckPanelContentKind(!!radio, pendingPlatform);

  if (contentKind === "pending-device") {
    content = (
      <DeviceForm
        onCancel={handleCancelPendingSource}
        onLoad={handleLoadDeviceInput}
      />
    );
  } else if (contentKind === "pending-file") {
    content = (
      <FileForm
        onCancel={handleCancelPendingSource}
        onLoad={handleFileDrop}
        onLoadUrl={handleLoadRemoteUrl}
      />
    );
  } else if (contentKind === "pending-external" && pendingPlatform) {
    const searchPlatform =
      pendingPlatform === "bandcamp" ||
      pendingPlatform === "soundcloud" ||
      pendingPlatform === "youtube" ||
      pendingPlatform === "radiogarden"
        ? pendingPlatform
        : "all";
    content = (
      <ExternalSearch
        initialPlatform={searchPlatform}
        key={searchPlatform}
        onCancel={handleCancelPendingSource}
        onLoad={handleLoadPlatformItem}
      />
    );
  } else if (contentKind === "loaded" && radio) {
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
          key={searchPlatform}
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
