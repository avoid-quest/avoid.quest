import { Button } from "@avoid.quest/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@avoid.quest/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import {
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Volume2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EffectChain } from "@/components/audio/effect-chain";
import type { Radio } from "@/lib/audio";
import {
  addDeckAEffect,
  addDeckBEffect,
  removeDeckAEffect,
  removeDeckBEffect,
  reorderDeckAEffects,
  reorderDeckBEffects,
  setDeckAChannelSelection,
  setDeckADeviceSource,
  setDeckBChannelSelection,
  setDeckBDeviceSource,
  updateDeckAEffect,
  updateDeckBEffect,
} from "@/lib/dj-actions";
import { isPlatformRadio } from "@/lib/external-url";
import { useDeckAState, useDeckBState } from "@/lib/hooks/use-deck-state";
import {
  setPendingPlatformItem,
  usePendingPlatformItem,
} from "@/lib/hooks/use-dj-state";
import { usePeakLevel } from "@/lib/hooks/use-peak-level";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import { isDeviceInputMetadata, type Platform } from "@/lib/platform-types";
import {
  setDeckAPeakLevel,
  setDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import { DeckLayout } from "./deck-layout";
import { DeviceForm } from "./device-form";
import { DjRadioList } from "./dj-radio-list";
import { InputDeckLayout } from "./input-deck-layout";
import { PlatformForm } from "./platform-form";

type DjDeckProps = {
  className?: string;
  deckId: "deck-a" | "deck-b";
  radios?: Radio[];
};

export function DjDeck({ className, deckId, radios = [] }: DjDeckProps) {
  if (deckId === "deck-a") {
    return <DjDeckA className={className} radios={radios} />;
  }
  return <DjDeckB className={className} radios={radios} />;
}

type DjDeckSideProps = {
  className?: string;
  radios: Radio[];
};

function DjDeckA(props: DjDeckSideProps) {
  const deckState = useDeckAState();
  return <DjDeckContent {...props} deckId="deck-a" deckState={deckState} />;
}

function DjDeckB(props: DjDeckSideProps) {
  const deckState = useDeckBState();
  return <DjDeckContent {...props} deckId="deck-b" deckState={deckState} />;
}

type DjDeckContentProps = DjDeckSideProps & {
  deckId: "deck-a" | "deck-b";
  deckState: ReturnType<typeof useDeckAState>;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: deck component handles multiple render states (empty, loading, device input, streaming, platform forms)
function DjDeckContent({
  className,
  deckId,
  radios,
  deckState,
}: DjDeckContentProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: deckId,
  });

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
    setPan,
    setSpeed,
    setChannelFilter,
    setEffectsDryWet,
  } = deckState;

  const { currentTrackIndex, metadata } = usePlatformMetadata(radio);
  const trackProgress = useTrackProgress(soundId);
  const peakLevel = usePeakLevel(soundId);

  // Publish peak levels to runtime store for mixer VU meters and mobile mini-mixer
  const setPeakLevel =
    deckId === "deck-a" ? setDeckAPeakLevel : setDeckBPeakLevel;
  useEffect(() => {
    setPeakLevel(peakLevel);
  }, [peakLevel, setPeakLevel]);

  // Throttle channel strip setters to ~30fps to prevent overwhelming audio manager
  const throttledSetPan = useThrottledParam(setPan);
  const throttledSetSpeed = useThrottledParam(setSpeed);
  const throttledSetChannelFilter = useThrottledParam(setChannelFilter);
  const throttledSetEffectsDryWet = useThrottledParam(setEffectsDryWet);
  const throttledSetVolume = useThrottledParam(setVolume);

  // Get effects actions based on deck
  const addEffect = deckId === "deck-a" ? addDeckAEffect : addDeckBEffect;
  const updateEffect =
    deckId === "deck-a" ? updateDeckAEffect : updateDeckBEffect;
  const removeEffect =
    deckId === "deck-a" ? removeDeckAEffect : removeDeckBEffect;
  const reorderEffects =
    deckId === "deck-a" ? reorderDeckAEffects : reorderDeckBEffects;

  // Get pending platform item from UI state
  const pendingPlatformItem = usePendingPlatformItem();

  const deckSide = deckId === "deck-a" ? "left" : "right";
  const [isChangingUrl, setIsChangingUrl] = useState(false);
  const [isChangingDevice, setIsChangingDevice] = useState(false);
  const isMobile = useIsMobile();

  // Check if this deck has a pending platform item
  const pendingPlatform =
    pendingPlatformItem?.deckId === deckId
      ? pendingPlatformItem.platform
      : undefined;

  // Check if current radio is a device input
  const isDeviceInput = radio?.platformMetadata?.platform === "device-input";

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const handleVolumeChange = (value: number[]) => {
    throttledSetVolume(value[0] ?? 0);
  };

  const handleClear = () => {
    loadTrack(deckSide, null, false);
    if (pendingPlatformItem?.deckId === deckId) {
      setPendingPlatformItem(null);
    }
  };

  const handleLoadTrack = async (streamUrl: string) => {
    if (radio) {
      await loadTrack(
        deckSide,
        { ...radio, streamUrl },
        true // auto-play
      );
    }
  };

  const handleLoadPlatformItem = (newRadio: Radio) => {
    loadTrack(deckSide, newRadio, false);
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

  const handleChangeDevice = useCallback(() => {
    setIsChangingDevice(true);
  }, []);

  const handleUrlChanged = (newRadio: Radio) => {
    setIsChangingUrl(false);
    handleLoadPlatformItem(newRadio);
  };

  const handleChangeUrl = useCallback(() => {
    setIsChangingUrl(true);
  }, []);

  const onChangeUrl = useMemo(
    () => (radio && isPlatformRadio(radio) ? handleChangeUrl : undefined),
    [radio, handleChangeUrl]
  );

  let content: React.ReactNode;

  if (radio) {
    if (isChangingUrl && isPlatformRadio(radio)) {
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
        <InputDeckLayout
          channelCount={deviceMeta.channelCount ?? 2}
          channelFilter={channelFilter}
          channelSelection={
            deviceMeta.channelSelection ?? { left: 0, right: 1 }
          }
          deckSide={deckSide}
          deviceLabel={deviceMeta.deviceLabel ?? radio.name}
          effects={effects}
          effectsDryWet={effectsDryWet}
          isLoading={isLoading}
          isPlaying={isPlaying}
          onAddEffect={addEffect}
          onChangeDevice={handleChangeDevice}
          onChannelFilterChange={throttledSetChannelFilter}
          onChannelSelectionChange={
            deckId === "deck-a"
              ? setDeckAChannelSelection
              : setDeckBChannelSelection
          }
          onClear={handleClear}
          onEffectsDryWetChange={throttledSetEffectsDryWet}
          onPanChange={throttledSetPan}
          onRemoveEffect={removeEffect}
          onReorderEffects={reorderEffects}
          onToggleMute={handlePlayPause}
          onUpdateEffect={updateEffect}
          onVolumeChange={handleVolumeChange}
          pan={pan}
          peakLevel={peakLevel}
          volume={volume}
        />
      );
    } else {
      content = (
        <DeckLayout
          channelFilter={channelFilter}
          currentTrackIndex={currentTrackIndex}
          deckSide={deckSide}
          effects={effects}
          effectsDryWet={effectsDryWet}
          isBuffering={isBuffering}
          isLoading={isLoading}
          isPlaying={isPlaying}
          metadata={metadata || radio.platformMetadata}
          onAddEffect={addEffect}
          onChangeUrl={onChangeUrl}
          onChannelFilterChange={throttledSetChannelFilter}
          onClear={handleClear}
          onEffectsDryWetChange={throttledSetEffectsDryWet}
          onPanChange={throttledSetPan}
          onPlayPause={handlePlayPause}
          onPlayTrack={handleLoadTrack}
          onRemoveEffect={removeEffect}
          onReorderEffects={reorderEffects}
          onSpeedChange={throttledSetSpeed}
          onUpdateEffect={updateEffect}
          onVolumeChange={handleVolumeChange}
          pan={pan}
          peakLevel={peakLevel}
          radio={radio}
          speed={speed}
          trackProgress={trackProgress}
          volume={volume}
        />
      );
    }
  } else if (pendingPlatform === "device-input") {
    content = (
      <DeviceForm onCancel={handleClear} onLoad={handleLoadDeviceInput} />
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
    // Mobile: Show inline radio list for loading
    content = (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <DjRadioList radios={radios} />
        <div className="border-t pt-2">
          <EffectChain
            effects={effects}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
          />
        </div>
      </div>
    );
  } else {
    // Desktop: Empty deck placeholder with deck-colored border
    const emptyBorderColor =
      deckId === "deck-a" ? "border-blue-500/30" : "border-amber-500/30";

    content = (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Drop Zone */}
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <div
            className={cn(
              "rounded-lg border-2 border-dashed p-6",
              emptyBorderColor
            )}
          >
            <Volume2Icon className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 font-medium text-muted-foreground text-sm">
              Drop a radio station here
            </p>
            <p className="mt-1 text-muted-foreground/60 text-xs">
              or pick from sources below
            </p>
          </div>
        </div>

        {/* Effects (can still configure before loading) */}
        <div className="border-t pt-2">
          <EffectChain
            effects={effects}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
          />
        </div>
      </div>
    );
  }

  const deckColorBorder =
    deckId === "deck-a"
      ? "border-l-2 border-l-blue-500/40"
      : "border-r-2 border-r-amber-500/40";

  return (
    <Card
      className={cn(
        "flex h-full min-h-0 w-full flex-col py-2 transition-colors",
        deckColorBorder,
        isOver ? "border-primary bg-primary/5" : "",
        className
      )}
      ref={setNodeRef}
    >
      <DeckHeader deckId={deckId} onReset={reset} radio={radio} />
      <CardContent className="flex h-full min-h-0 flex-col">
        {content}
      </CardContent>
    </Card>
  );
}

type DeckHeaderProps = {
  deckId: "deck-a" | "deck-b";
  radio: Radio | null;
  onReset: () => Promise<void>;
};

function DeckHeader({ deckId, radio, onReset }: DeckHeaderProps) {
  const handleCopyStreamLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!radio) {
      return;
    }
    try {
      await navigator.clipboard.writeText(radio.streamUrl);
      toast.success("Stream link copied to clipboard");
    } catch {
      toast.error("Failed to copy stream link");
    }
  };

  const handleGoToWebsite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!radio?.websiteUrl) {
      return;
    }
    window.open(radio.websiteUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <CardHeader className="sm:pb-4">
      <div className="flex items-center justify-between">
        <CardTitle
          className={cn(
            "text-center",
            deckId === "deck-a" ? "text-blue-500" : "text-amber-500"
          )}
        >
          {deckId === "deck-a" ? "Deck A" : "Deck B"}
        </CardTitle>
        {/* Always render button to prevent layout shift, but hide when no radio */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="h-8 w-8 p-0"
              disabled={!radio}
              onClick={(e) => e.stopPropagation()}
              size="sm"
              style={{ visibility: radio ? "visible" : "hidden" }}
              variant="ghost"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          {radio && (
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyStreamLink}>
                <CopyIcon className="mr-2 size-4" />
                Copy Stream Link
              </DropdownMenuItem>
              {radio.websiteUrl?.trim() !== "" && (
                <DropdownMenuItem onClick={handleGoToWebsite}>
                  <ExternalLinkIcon className="mr-2 size-4" />
                  Go to Website
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await onReset();
                    toast.success("Deck reset");
                  } catch (error) {
                    const message =
                      error instanceof Error
                        ? error.message
                        : "Failed to reset deck";
                    toast.error(message);
                  }
                }}
              >
                <RefreshCwIcon className="mr-2 size-4" />
                Reset Deck
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>
    </CardHeader>
  );
}
