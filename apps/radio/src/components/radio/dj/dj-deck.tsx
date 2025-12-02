import type { Platform } from "@avoid.quest/radio-shared";
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
  Copy,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { isPlatformRadio } from "@/lib/external-url";
import { useDeckState } from "@/lib/hooks/use-deck-state";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import { useDjStore } from "@/lib/stores/dj-store";
import type { Radio } from "@/lib/types";
import { DeckLayout } from "./deck-layout";
import { DeckSections } from "./deck-sections";
import { DjRadioList } from "./dj-radio-list";
import { PlatformForm } from "./platform-form";

type DjDeckProps = {
  className?: string;
  deckId: "left-deck" | "right-deck";
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
    volume,
    play,
    pause,
    setVolume,
    loadTrack,
    soundId,
    reset,
  } = useDeckState(deckId);

  const { currentTrackIndex, metadata } = usePlatformMetadata(radio);
  const trackProgress = useTrackProgress(soundId);

  // UI State and deck-specific effects from store
  const {
    pendingPlatformItem,
    setPendingPlatformItem,
    effects,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffects,
  } = useDjStore(
    useShallow((state) => ({
      pendingPlatformItem: state.ui.pendingPlatformItem,
      setPendingPlatformItem: state.setPendingPlatformItem,
      effects:
        deckId === "left-deck"
          ? state.leftDeck.effects
          : state.rightDeck.effects,
      addEffect:
        deckId === "left-deck" ? state.addLeftEffect : state.addRightEffect,
      updateEffect:
        deckId === "left-deck"
          ? state.updateLeftEffect
          : state.updateRightEffect,
      removeEffect:
        deckId === "left-deck"
          ? state.removeLeftEffect
          : state.removeRightEffect,
      reorderEffects:
        deckId === "left-deck"
          ? state.reorderLeftEffects
          : state.reorderRightEffects,
    }))
  );

  const deckSide = deckId === "left-deck" ? "left" : "right";
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
    setVolume(value[0] ?? 0);
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
          currentTrackIndex={currentTrackIndex}
          effects={effects}
          isLoading={isLoading}
          isPlaying={isPlaying}
          metadata={metadata || radio.platformMetadata}
          onAddEffect={addEffect}
          onChangeUrl={onChangeUrl}
          onClear={handleClear}
          onPlayPause={handlePlayPause}
          onPlayTrack={handleLoadTrack}
          onRemoveEffect={removeEffect}
          onReorderEffects={reorderEffects}
          onUpdateEffect={updateEffect}
          onVolumeChange={handleVolumeChange}
          radio={radio}
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
          <DeckSections
            currentTrackIndex={0}
            effects={effects}
            metadata={null}
            onAddEffect={addEffect}
            onPlayTrack={async () => {
              // No-op when no radio is loaded
            }}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
          />
        </TabsContent>
      </Tabs>
    );
  } else {
    // Desktop: Original layout
    content = (
      <div className="flex h-full min-h-0 flex-col">
        {/* Drop Zone */}
        <div className="flex shrink-0 flex-col items-center justify-center py-8 text-center">
          <div className="rounded-lg border-2 border-muted-foreground/25 border-dashed p-2 sm:p-6">
            <Volume2 className="mx-auto size-8 text-muted-foreground sm:size-10" />
            <p className="mt-2 text-muted-foreground text-sm">
              Drop a radio station here
            </p>
          </div>
        </div>
        {/* Filter Section - Always visible */}
        <div className="flex min-h-0 flex-1 flex-col border-t pt-3">
          <DeckSections
            currentTrackIndex={0}
            effects={effects}
            metadata={null}
            onAddEffect={addEffect}
            onPlayTrack={async () => {
              // No-op when no radio is loaded
            }}
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
  deckId: "left-deck" | "right-deck";
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
          {deckId === "left-deck" ? "Left Deck" : "Right Deck"}
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
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          {radio?.valueOf() && (
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyStreamLink}>
                <Copy className="mr-2 size-4" />
                Copy Stream Link
              </DropdownMenuItem>
              {radio.websiteUrl?.trim() !== "" && (
                <DropdownMenuItem onClick={handleGoToWebsite}>
                  <ExternalLink className="mr-2 size-4" />
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
                <RefreshCw className="mr-2 size-4" />
                Reset Deck
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>
    </CardHeader>
  );
}
