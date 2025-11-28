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
import { cn } from "@workspace/ui/lib/utils";
import {
  Copy,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { isPlatformRadio } from "@/lib/external-url";
import type { Platform, PlatformMetadata } from "@/lib/external-url/types";
import { useDeckState } from "@/lib/hooks/use-deck-state";
import { usePlatformMetadata } from "@/lib/hooks/use-platform-metadata";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import { useDjStore } from "@/lib/stores/dj-store";
import type { Radio } from "@/lib/types";
import { DeckLayout } from "./deck-layout";
import { PlatformForm } from "./platform-form";
import { PlatformItemInfo } from "./platform-item-info";
import { PlatformTrackInfo } from "./platform-track-info";
import { PlaylistView } from "./playlist-view";

type DjDeckProps = {
  className?: string;
  deckId: "left-deck" | "right-deck";
};

export function DjDeck({ className, deckId }: DjDeckProps) {
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

  // UI State from store
  const { pendingPlatformItem, setPendingPlatformItem } = useDjStore(
    useShallow((state) => ({
      pendingPlatformItem: state.ui.pendingPlatformItem,
      setPendingPlatformItem: state.setPendingPlatformItem,
    }))
  );

  const deckSide = deckId === "left-deck" ? "left" : "right";
  const [isChangingUrl, setIsChangingUrl] = useState(false);

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

  let content: React.ReactNode;

  if (radio) {
    if (isChangingUrl && isPlatformRadio(radio)) {
      content = (
        <PlatformForm
          currentUrl={radio.platformMetadata?.url}
          editMode={true}
          initialPlatform={radio.platformMetadata?.platform as Platform}
          onLoad={handleUrlChanged}
        />
      );
    } else {
      content = (
        <DeckLayout
          isLoading={isLoading}
          isPlaying={isPlaying}
          metadata={metadata || radio.platformMetadata}
          onChangeUrl={
            isPlatformRadio(radio) ? () => setIsChangingUrl(true) : undefined
          }
          onClear={handleClear}
          onPlayPause={handlePlayPause}
          onVolumeChange={handleVolumeChange}
          radio={radio}
          trackProgress={trackProgress}
          volume={volume}
        >
          {metadata && (
            <PlatformActions
              currentTrackIndex={currentTrackIndex}
              metadata={metadata}
              onPlayTrack={handleLoadTrack}
            />
          )}
        </DeckLayout>
      );
    }
  } else if (pendingPlatform) {
    content = (
      <PlatformForm
        initialPlatform={pendingPlatform}
        onLoad={handleLoadPlatformItem}
      />
    );
  } else {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center text-center sm:space-y-4">
        <div className="rounded-lg border-2 border-muted-foreground/25 border-dashed p-2 sm:p-6">
          <Volume2 className="mx-auto size-8 text-muted-foreground sm:size-10" />
          <p className="mt-2 text-muted-foreground text-sm">
            Drop a radio station here
          </p>
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "h-full w-full transition-colors",
        isOver ? "border-primary bg-primary/5" : "",
        className
      )}
      ref={setNodeRef}
    >
      <DeckHeader deckId={deckId} onReset={reset} radio={radio} />
      <CardContent className="flex h-full flex-col p-6">{content}</CardContent>
    </Card>
  );
}

type DeckHeaderProps = {
  deckId: "left-deck" | "right-deck";
  radio: Radio | null;
  onReset: () => void;
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
        {radio && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-8 w-8 p-0"
                onClick={(e) => e.stopPropagation()}
                size="sm"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyStreamLink}>
                <Copy className="mr-2 size-4" />
                Copy Stream Link
              </DropdownMenuItem>
              {radio.websiteUrl && (
                <DropdownMenuItem onClick={handleGoToWebsite}>
                  <ExternalLink className="mr-2 size-4" />
                  Go to Website
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                  toast.success("Deck reset");
                }}
              >
                <RefreshCw className="mr-2 size-4" />
                Reset Deck
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </CardHeader>
  );
}

type PlatformActionsProps = {
  metadata: PlatformMetadata;
  currentTrackIndex: number;
  onPlayTrack: (streamUrl: string) => void;
};

function PlatformActions({
  metadata,
  currentTrackIndex,
  onPlayTrack,
}: PlatformActionsProps) {
  const isCollection =
    (metadata.platform === "bandcamp" && metadata.itemType === "album") ||
    (metadata.platform === "soundcloud" && metadata.itemType === "playlist");

  if (isCollection && metadata.tracks && metadata.tracks.length > 0) {
    return (
      <div className="space-y-3">
        <PlatformItemInfo
          duration={metadata.duration}
          trackCount={metadata.trackCount}
        />
        <PlaylistView
          artist={metadata.artist}
          currentTrackIndex={currentTrackIndex}
          onPlayTrack={onPlayTrack}
          tracks={metadata.tracks}
        />
      </div>
    );
  }

  if (
    (metadata.platform === "bandcamp" && metadata.itemType === "track") ||
    (metadata.platform === "soundcloud" && metadata.itemType === "track")
  ) {
    return (
      <PlatformTrackInfo
        albumName={metadata.albumName}
        artist={metadata.artist}
        duration={metadata.duration}
      />
    );
  }

  return null;
}
