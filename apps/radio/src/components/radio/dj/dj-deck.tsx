import { useDroppable } from "@dnd-kit/core";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import {
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Volume2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
  updateDeckAEffect,
  updateDeckBEffect,
} from "@/lib/dj-actions";
import { isPlatformRadio } from "@/lib/external-url";
import { useDeckState } from "@/lib/hooks/use-deck-state";
import {
  setPendingPlatformItem,
  useDeckA,
  useDeckB,
  usePendingPlatformItem,
} from "@/lib/hooks/use-dj-state";
import { usePeakLevel } from "@/lib/hooks/use-peak-level";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import type { Platform } from "@/lib/platform-types";
import { DeckLayout } from "./deck-layout";
import { DjRadioList } from "./dj-radio-list";
import { PlatformForm } from "./platform-form";

type DjDeckProps = {
  className?: string;
  deckId: "deck-a" | "deck-b";
  radios?: Radio[];
};

export function DjDeck({ className, deckId, radios = [] }: DjDeckProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: deckId,
  });

  // Use custom hooks for state management
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
    // Channel strip state
    pan,
    speed,
    channelFilter,
    effectsDryWet,
    setPan,
    setSpeed,
    setChannelFilter,
    setEffectsDryWet,
  } = useDeckState(deckId);

  const { currentTrackIndex, metadata } = usePlatformMetadata(radio);
  const trackProgress = useTrackProgress(soundId);
  const peakLevel = usePeakLevel(soundId);

  // Throttle channel strip setters to ~30fps to prevent overwhelming audio manager
  const throttledSetPan = useThrottledParam(setPan);
  const throttledSetSpeed = useThrottledParam(setSpeed);
  const throttledSetChannelFilter = useThrottledParam(setChannelFilter);
  const throttledSetEffectsDryWet = useThrottledParam(setEffectsDryWet);
  const throttledSetVolume = useThrottledParam(setVolume);

  // Get effects from the deck state
  const deckA = useDeckA();
  const deckB = useDeckB();
  const effects =
    deckId === "deck-a" ? (deckA?.effects ?? []) : (deckB?.effects ?? []);

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
  const isMobile = useIsMobile();

  // Check if this deck has a pending platform item
  const pendingPlatform =
    pendingPlatformItem?.deckId === deckId
      ? pendingPlatformItem.platform
      : undefined;

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
  } else if (pendingPlatform) {
    content = (
      <PlatformForm
        initialPlatform={pendingPlatform}
        onCancel={handleClear}
        onLoad={handleLoadPlatformItem}
      />
    );
  } else if (isMobile) {
    // Mobile: Wrap in tabs with empty Source tab
    content = (
      <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="effects">Effects</TabsTrigger>
        </TabsList>

        {/* Source Tab with radio list on mobile */}
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="source"
        >
          <DjRadioList radios={radios} />
        </TabsContent>

        {/* Effects Tab */}
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="effects"
        >
          <EffectChain
            effects={effects}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
          />
        </TabsContent>
      </Tabs>
    );
  } else {
    // Desktop: Minimal empty deck placeholder
    content = (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Drop Zone */}
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <div className="rounded-lg border-2 border-muted-foreground/25 border-dashed p-4">
            <Volume2Icon className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 text-muted-foreground text-sm">
              Drop a source here
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

  return (
    <Card
      className={cn(
        "flex h-full min-h-0 w-full flex-col py-2 transition-colors",
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
    } catch (error) {
      console.error("Failed to copy stream link:", error);
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
        <CardTitle className="text-center">
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
