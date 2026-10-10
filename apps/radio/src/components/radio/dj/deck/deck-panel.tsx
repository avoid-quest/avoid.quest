// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChannelSelection,
  EffectConfig,
  EffectType,
  Radio,
} from "@/lib/audio";
import { isAudioFile } from "@/lib/audio/file-metadata";
import type { BrowserAudioSource } from "@/lib/audio/playback/display-audio";
import { channelEffects } from "@/lib/channel-effects";
import { createDjDeckEffectChange, getDjDeckModule } from "@/lib/dj-deck";
import { useDeckAState, useDeckBState } from "@/lib/hooks/use-deck-state";
import { useDjSession } from "@/lib/hooks/use-dj-session";
import { useMidiEffectRegistration } from "@/lib/hooks/use-midi-effect-registration";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import {
  isDeviceInputMetadata,
  isFileMetadata,
  isStaticAudioMetadata,
} from "@/lib/platform-types";
import { setDjError } from "@/lib/stores/dj-runtime-store";
import { BrowserAudioForm } from "../../browser-audio-form";
import { DeviceForm } from "../device-form";
import { DjRadioList } from "../dj-radio-list";
import { ExternalSearch } from "../external-search";
import { FileForm } from "../file-form";
import { describeFileLoadFailure } from "../file-load-failure";
import { type DeckContextValue, DeckProvider } from "./deck-context";
import { DeviceInputContent } from "./deck-device-input-content";
import { DeckEmpty } from "./deck-empty";
import { DeckHeader } from "./deck-header";
import { LoadedDeckContent } from "./deck-loaded-content";
import {
  calculateHasTracklist,
  getChangeSourceSearchPlatform,
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
    pendingPlatform,
    cancelPendingSource,
  } = deckState;
  const deck = getDjDeckModule().deck(deckId);
  const djSession = useDjSession();
  const effectsTempo = djSession?.tempo ?? 120;

  const { currentTrackIndex, metadata } = usePlatformMetadata(radio);
  const trackProgress = useTrackProgress(soundId);

  // Throttle channel strip setters
  const throttledSetPan = useThrottledParam(setPan);
  const throttledSetSpeed = useThrottledParam(setSpeed);
  const throttledSetChannelFilter = useThrottledParam(setChannelFilter);
  const throttledSetEffectsDryWet = useThrottledParam(setEffectsDryWet);
  const throttledSetVolume = useThrottledParam(setVolume);

  // MIDI effect registration
  useMidiEffectRegistration(deckId, effects);

  // Effect actions
  const addEffect = (type: EffectType) =>
    deck.change(createDjDeckEffectChange(type));
  const updateEffect = (effectId: string, patch: Partial<EffectConfig>) =>
    deck.change({
      change: { effectId, patch, type: "update" },
      type: "effect",
    });
  const removeEffect = (effectId: string) =>
    deck.change({ change: { effectId, type: "remove" }, type: "effect" });
  const reorderEffects = (effectIds: string[]) =>
    deck.change({
      change: { effectIds, type: "reorder" },
      type: "effect",
    });
  const setChannelSelection = (selection: ChannelSelection) =>
    deck.change({ selection, type: "device-channel-selection" });

  const deckSide = deckId === "deck-a" ? "left" : "right";
  const [isChangingUrl, setIsChangingUrl] = useState(false);
  const [isPickingSource, setIsPickingSource] = useState(false);
  const [isChangingDevice, setIsChangingDevice] = useState(false);
  const [isChangingFile, setIsChangingFile] = useState(false);

  const isDeviceInput = radio?.platformMetadata?.platform === "device-input";
  const isFileSource =
    isFileMetadata(radio?.platformMetadata) ||
    isStaticAudioMetadata(radio?.platformMetadata);
  const changeSourceSearchPlatform = getChangeSourceSearchPlatform(
    radio?.platformMetadata
  );
  const effectiveMetadata = metadata || radio?.platformMetadata;
  const hasTracklist = calculateHasTracklist(effectiveMetadata);
  const streamingMeta = isStreamingMetadata(effectiveMetadata)
    ? effectiveMetadata
    : null;
  const tracks = streamingMeta?.tracks;

  const isSeekable =
    trackProgress?.duration !== null &&
    Number.isFinite(trackProgress.duration) &&
    trackProgress.duration > 0;

  // File drag-and-drop
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDragCounter = useRef(0);

  /** Load a file or remote file; resolves to why it failed, or null. */
  const loadFile = async (
    intent:
      | { file: File; type: "file" }
      | { files: readonly File[]; type: "files" }
      | { type: "static-audio-url"; url: string }
  ): Promise<string | null> => {
    const result = await loadSource(intent);
    return result.type === "failed" ? result.message : null;
  };
  const handleLoadFile = (file: File) => loadFile({ file, type: "file" });
  const handleLoadFiles = (files: readonly File[]) =>
    loadFile({ files, type: "files" });
  const handleLoadRemoteUrl = (url: string) =>
    loadFile({ type: "static-audio-url", url });

  // A file dropped on the deck has no form to report to, so the mixer does.
  const handleFileDrop = useCallback(
    (file: File) => {
      loadSource({ file, type: "file" })
        .then((result) => {
          if (result.type === "failed") {
            setDjError(describeFileLoadFailure(result.message), deckId);
          }
        })
        .catch((error) => {
          console.error("[dj] Failed to load file source:", error);
        });
    },
    [deckId, loadSource]
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
      const [file] = e.dataTransfer.files;
      if (file && isAudioFile(file)) {
        handleFileDrop(file);
      }
    },
    [handleFileDrop]
  );

  const handleClear = () => {
    loadSource({ autoPlay: false, radio: null, type: "track" }).catch(
      (error) => {
        console.error("[dj] Failed to clear deck source:", error);
      }
    );
  };

  const handleLoadTrack = async (streamUrl: string) => {
    if (!radio) {
      return;
    }
    await loadSource({ autoPlay: true, radio, streamUrl, type: "track-url" });
  };

  const handleLoadPlatformItem = async (newRadio: Radio) => {
    await loadSource({ autoPlay: false, radio: newRadio, type: "track" });
  };

  const handleLoadDeviceInput = async (
    deviceId: string,
    deviceLabel: string
  ) => {
    await loadSource({ deviceId, deviceLabel, type: "device-input" });
    setIsChangingDevice(false);
  };

  const handleUrlChanged = (newRadio: Radio) => {
    setIsChangingUrl(false);
    handleLoadPlatformItem(newRadio);
  };
  const handleTempoChange = (tempo: number) => {
    channelEffects
      .setTempo("dj", tempo)
      .catch((error: unknown) =>
        console.warn(
          "[ChannelEffects] Could not reconcile Channel Effects",
          error
        )
      );
  };
  const handleCancelFileChange = () => setIsChangingFile(false);
  // Keep the change form open until the new file loads, so a failure shows
  // in the form with what the user typed still there.
  const closeFileChangeOnLoad = async (
    loading: Promise<string | null>
  ): Promise<string | null> => {
    const failure = await loading;
    if (!failure) {
      setIsChangingFile(false);
    }
    return failure;
  };
  const handleFileChanged = (file: File) =>
    closeFileChangeOnLoad(handleLoadFile(file));
  const handleRemoteUrlChanged = (url: string) =>
    closeFileChangeOnLoad(handleLoadRemoteUrl(url));
  const handleCancelUrlChange = () => setIsChangingUrl(false);
  const handleCancelDeviceChange = () => setIsChangingDevice(false);
  const handleChangeDevice = () => setIsChangingDevice(true);
  const handleToggleMute = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };
  const handleChangeSource = () => {
    if (isFileSource) {
      setIsChangingFile(true);
    } else if (changeSourceSearchPlatform) {
      setIsChangingUrl(true);
    } else {
      setIsPickingSource(true);
    }
  };
  const handleCancelPickSource = () => setIsPickingSource(false);

  // A new source arrived (from the picker or a drop): close the picker.
  // Keyed on the source's identity and the sound playing it, not the
  // record: every channel write (a fader on either deck, say) hands the
  // deck a new `radio` object. A device or shared tab keeps the deck's id
  // and has no stream URL, but every load that commits plays on a new sound.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the deck's source changes
  useEffect(() => {
    setIsPickingSource(false);
  }, [radio?.id, radio?.streamUrl, soundId]);

  // A different source replaced the one being changed (a dropped file, say):
  // close the change forms too. Moving to the next track of the same item
  // keeps the source, and the form, as they are.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the deck's source is replaced
  useEffect(() => {
    setIsChangingUrl(false);
    setIsChangingFile(false);
    setIsChangingDevice(false);
  }, [radio?.id]);

  // Build the DeckContext value for child components
  const contextValue: DeckContextValue = {
    addEffect,
    autoplay,
    channelFilter,
    currentTrackIndex,
    deckId,
    deckSide,
    effects,
    effectsDryWet,
    effectsTempo,
    hasTracklist,
    isBuffering,
    isFileSource,
    isLoading,
    isPlaying,
    isSeekable,
    loadTrack: handleLoadTrack,
    metadata: effectiveMetadata,
    pan,
    pause,
    play,
    radio,
    removeEffect,
    reorderEffects,
    repeat,
    reset,
    seek,
    setAutoplay,
    setChannelFilter: throttledSetChannelFilter,
    setEffectsDryWet: throttledSetEffectsDryWet,
    setEffectsTempo: handleTempoChange,
    setPan: throttledSetPan,
    setRepeat,
    setSpeed: throttledSetSpeed,
    setVolume: throttledSetVolume,
    soundId,
    speed,
    trackProgress,
    tracks,
    updateEffect,
    volume,
  };

  // Determine which content to render
  let content: React.ReactNode;
  const contentKind = resolveDeckPanelContentKind(!!radio, pendingPlatform);

  if (contentKind === "pending-browser") {
    content = (
      <BrowserAudioForm
        onCancel={cancelPendingSource}
        onLoad={async (sourceUrl, deviceLabel) => {
          await loadSource({
            capture: "display",
            deviceId: "display",
            deviceLabel,
            sourceUrl,
            type: "device-input",
          });
        }}
        source={pendingPlatform as BrowserAudioSource}
      />
    );
  } else if (contentKind === "pending-device") {
    content = (
      <DeviceForm
        onCancel={cancelPendingSource}
        onLoad={handleLoadDeviceInput}
      />
    );
  } else if (contentKind === "pending-file") {
    content = (
      <FileForm
        onCancel={cancelPendingSource}
        onLoad={handleLoadFile}
        onLoadFiles={handleLoadFiles}
        onLoadUrl={handleLoadRemoteUrl}
      />
    );
  } else if (contentKind === "pending-external" && pendingPlatform) {
    const searchPlatform =
      pendingPlatform === "bandcamp" ||
      pendingPlatform === "mixcloud" ||
      pendingPlatform === "soundcloud" ||
      pendingPlatform === "youtube" ||
      pendingPlatform === "radiogarden"
        ? pendingPlatform
        : "all";
    content = (
      <ExternalSearch
        initialPlatform={searchPlatform}
        key={searchPlatform}
        onCancel={cancelPendingSource}
        onLoad={handleLoadPlatformItem}
        radios={radios}
      />
    );
  } else if (contentKind === "loaded" && radio) {
    if (isChangingFile && isFileSource) {
      content = (
        <FileForm
          onCancel={handleCancelFileChange}
          onLoad={handleFileChanged}
          onLoadFiles={(files) => closeFileChangeOnLoad(handleLoadFiles(files))}
          onLoadUrl={handleRemoteUrlChanged}
        />
      );
    } else if (isPickingSource) {
      content = (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1">
            <DjRadioList deckId={deckId} radios={radios} />
          </div>
          <div className="flex justify-end border-border/50 border-t pt-2">
            <Button
              className="h-7 text-xs"
              onClick={handleCancelPickSource}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    } else if (isChangingUrl && changeSourceSearchPlatform) {
      content = (
        <ExternalSearch
          initialPlatform={changeSourceSearchPlatform}
          key={changeSourceSearchPlatform}
          onCancel={handleCancelUrlChange}
          onLoad={handleUrlChanged}
          radios={radios}
        />
      );
    } else if (isChangingDevice && isDeviceInput) {
      content = (
        <DeviceForm
          onCancel={handleCancelDeviceChange}
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
            onChangeDevice={
              deviceMeta.capture === "display"
                ? () => setIsPickingSource(true)
                : handleChangeDevice
            }
            onChannelSelectionChange={setChannelSelection}
            onClear={handleClear}
            onToggleMute={handleToggleMute}
          />
        </DeckProvider>
      );
    } else {
      // Normal deck (streaming/file)
      content = (
        <DeckProvider value={contextValue}>
          <LoadedDeckContent
            onChangeUrl={handleChangeSource}
            onClear={handleClear}
          />
        </DeckProvider>
      );
    }
  } else {
    content = (
      <DeckEmpty
        addEffect={addEffect}
        deckId={deckId}
        effects={effects}
        radios={radios}
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
        "relative flex h-full min-h-0 w-full flex-col border-border/50 transition-colors",
        isFileDragOver ? "bg-primary/5 ring-2 ring-primary/50" : "",
        className
      )}
      onDragEnter={handleNativeDragEnter}
      onDragLeave={handleNativeDragLeave}
      onDragOver={handleNativeDragOver}
      onDrop={handleNativeDrop}
    >
      <DeckHeader deckId={deckId} onReset={reset} radio={radio} />
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden px-1.5 pb-1.5 sm:px-2 sm:pb-2">
        {content}
      </div>
    </div>
  );
}
