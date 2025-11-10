"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useState } from "react";
import type { PlatformTrack } from "@/lib/external-url/types";

type PlaylistViewProps = {
  tracks: PlatformTrack[];
  currentTrackIndex: number;
  onTrackSelect: (index: number) => void;
  onPlayTrack: (streamUrl: string) => void;
  artist?: string;
  className?: string;
};

export function PlaylistView({
  tracks,
  currentTrackIndex,
  onTrackSelect,
  onPlayTrack,
  artist,
  className,
}: PlaylistViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (tracks.length === 0) {
    return null;
  }

  const currentTrack = tracks[currentTrackIndex];
  const hasNext = currentTrackIndex < tracks.length - 1;
  const hasPrevious = currentTrackIndex > 0;

  const handleNext = () => {
    if (hasNext) {
      const nextIndex = currentTrackIndex + 1;
      const nextTrack = tracks[nextIndex];
      if (nextTrack) {
        onTrackSelect(nextIndex);
        onPlayTrack(nextTrack.streamUrl);
      }
    }
  };

  const handlePrevious = () => {
    if (hasPrevious) {
      const prevIndex = currentTrackIndex - 1;
      const prevTrack = tracks[prevIndex];
      if (prevTrack) {
        onTrackSelect(prevIndex);
        onPlayTrack(prevTrack.streamUrl);
      }
    }
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) {
      return "";
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="font-medium text-muted-foreground text-xs">
          Playlist - {tracks.length} tracks
        </div>
        {tracks.length > 1 && (
          <Button
            className="h-6 px-2 text-xs"
            onClick={() => setIsExpanded(!isExpanded)}
            size="sm"
            variant="ghost"
          >
            {isExpanded ? "Hide" : "Show"} List
          </Button>
        )}
      </div>

      {/* Current Track Info */}
      {currentTrack && (
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-sm">
                {currentTrack.name}
              </div>
              {artist && (
                <div className="truncate text-muted-foreground text-xs">
                  {artist}
                </div>
              )}
              {currentTrack.duration && (
                <div className="text-muted-foreground text-xs">
                  {formatDuration(currentTrack.duration)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      {tracks.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            className="h-8 w-8 p-0"
            disabled={!hasPrevious}
            onClick={handlePrevious}
            size="sm"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="text-muted-foreground text-xs">
            {currentTrackIndex + 1} / {tracks.length}
          </div>
          <Button
            className="h-8 w-8 p-0"
            disabled={!hasNext}
            onClick={handleNext}
            size="sm"
            variant="outline"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Expanded Track List */}
      {isExpanded && tracks.length > 1 && (
        <div className="h-48 overflow-y-auto rounded-md border">
          <div className="space-y-1 p-2">
            {tracks.map((track, index) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-muted/50",
                  index === currentTrackIndex && "bg-primary/10"
                )}
                key={track.streamUrl || index}
                onClick={() => {
                  onTrackSelect(index);
                  onPlayTrack(track.streamUrl);
                }}
                type="button"
              >
                <div className="flex shrink-0 items-center justify-center">
                  {index === currentTrackIndex ? (
                    <Play className="size-3 text-primary" />
                  ) : (
                    <div className="text-muted-foreground text-xs">
                      {index + 1}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{track.name}</div>
                  {track.duration && (
                    <div className="text-muted-foreground text-xs">
                      {formatDuration(track.duration)}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
