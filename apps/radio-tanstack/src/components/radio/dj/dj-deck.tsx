"use client";

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
import { PlayPauseButton } from "@workspace/ui/components/play-pause-button";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { Copy, ExternalLink, MoreHorizontal, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Platform, PlatformMetadata } from "@/lib/external-url/types";
import type { Radio } from "@/lib/types";
import { RadioLogo } from "../radio-logo";
import { RadioNameLink } from "../radio-name-link";
import { PlatformForm } from "./platform-form";
import { PlatformItemInfo } from "./platform-item-info";
import { PlatformTrackInfo } from "./platform-track-info";
import { PlaylistView } from "./playlist-view";

const MAX_VOLUME = 100;

type DjDeckProps = {
  className?: string;
  deckId: string;
  radio: Radio | null;
  isPlaying: boolean;
  isLoading?: boolean;
  volume: number;
  onPlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  onClear: () => void;
  onLoadTrack?: (streamUrl: string) => void;
  onLoadPlatformItem?: (radio: Radio) => void;
  pendingPlatform?: Platform;
};

export function DjDeck({
  className,
  deckId,
  radio,
  isPlaying,
  isLoading = false,
  volume,
  onPlayPause,
  onVolumeChange,
  onClear,
  onLoadTrack,
  onLoadPlatformItem,
  pendingPlatform,
}: DjDeckProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: deckId,
  });

  // Track current track index for playlists/albums
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const prevRadioIdRef = useRef<number | undefined>(radio?.id);

  // Reset track index when radio changes
  useEffect(() => {
    if (prevRadioIdRef.current !== radio?.id) {
      setCurrentTrackIndex(0);
      prevRadioIdRef.current = radio?.id;
    }
  }, [radio]);

  // Update track index when streamUrl changes to match current track
  useEffect(() => {
    if (!radio?.platformMetadata?.tracks) {
      return;
    }

    const metadata = radio.platformMetadata;
    const isCollection =
      (metadata.platform === "bandcamp" && metadata.itemType === "album") ||
      (metadata.platform === "soundcloud" && metadata.itemType === "playlist");

    if (isCollection && metadata.tracks) {
      const index = metadata.tracks.findIndex(
        (track) => track.streamUrl === radio.streamUrl
      );
      if (index !== -1) {
        setCurrentTrackIndex(index);
      }
    }
  }, [radio?.streamUrl, radio?.platformMetadata]);

  const handleVolumeChange = (value: number[]) => {
    onVolumeChange(value[0] ?? 0);
  };

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

  const handlePlayTrack = (streamUrl: string) => {
    if (onLoadTrack) {
      onLoadTrack(streamUrl);
    }
  };

  const handleTrackSelect = (index: number) => {
    setCurrentTrackIndex(index);
  };

  const platformMetadata = radio?.platformMetadata;

  return (
    <Card
      className={cn(
        "h-full w-full transition-colors",
        isOver ? "border-primary bg-primary/5" : "",
        className
      )}
      ref={setNodeRef}
    >
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex h-full flex-col space-y-6">
        {radio ? (
          <>
            {/* Radio Info */}
            <div className="flex flex-col items-center space-y-4">
              <div className="relative hidden p-3 sm:block">
                <RadioLogo
                  className="rounded-lg"
                  logoUrl={radio.logoUrl}
                  name={radio.name}
                  size="2xl"
                />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-lg">
                  <RadioNameLink radio={radio} />
                </h3>
                {radio.description && (
                  <p className="text-muted-foreground text-sm">
                    {radio.description}
                  </p>
                )}
              </div>
            </div>

            {/* Platform-Specific Actions */}
            {platformMetadata && (
              <PlatformActions
                currentTrackIndex={currentTrackIndex}
                metadata={platformMetadata}
                onPlayTrack={handlePlayTrack}
                onTrackSelect={handleTrackSelect}
              />
            )}

            {/* Play/Pause Button */}
            <div className="flex justify-center">
              <PlayPauseButton
                disabled={!radio}
                isLoading={isLoading}
                isPlaying={isPlaying}
                onClick={onPlayPause}
              />
            </div>

            {/* Volume Control */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Volume</span>
                <span className="font-mono text-sm">
                  {Math.round(volume * MAX_VOLUME)}%
                </span>
              </div>
              <Slider
                className="w-full"
                max={1}
                min={0}
                onValueChange={handleVolumeChange}
                step={0.01}
                value={[volume]}
              />
            </div>

            {/* Clear Button */}
            <Button
              className="w-full"
              onClick={onClear}
              size="sm"
              variant="outline"
            >
              Clear Deck
            </Button>
          </>
        ) : (
          (() => {
            if (onLoadPlatformItem && pendingPlatform) {
              return (
                <PlatformForm
                  initialPlatform={pendingPlatform}
                  onLoad={onLoadPlatformItem}
                />
              );
            }
            return (
              <div className="flex flex-1 flex-col items-center justify-center text-center sm:space-y-4">
                <div className="rounded-lg border-2 border-muted-foreground/25 border-dashed p-2 sm:p-6">
                  <Volume2 className="mx-auto size-8 text-muted-foreground sm:size-10" />
                  <p className="mt-2 text-muted-foreground text-sm">
                    Drop a radio station here
                  </p>
                </div>
              </div>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}

type PlatformActionsProps = {
  metadata: PlatformMetadata;
  currentTrackIndex: number;
  onPlayTrack: (streamUrl: string) => void;
  onTrackSelect: (index: number) => void;
};

function PlatformActions({
  metadata,
  currentTrackIndex,
  onPlayTrack,
  onTrackSelect,
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
          onTrackSelect={onTrackSelect}
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
