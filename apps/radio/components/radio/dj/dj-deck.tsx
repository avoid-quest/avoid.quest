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
import { toast } from "sonner";
import type { Radio } from "@/lib/types";
import { RadioLogo } from "../radio-logo";
import { RadioNameLink } from "../radio-name-link";

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
}: DjDeckProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: deckId,
  });

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
          <div className="flex flex-1 flex-col items-center justify-center text-center sm:space-y-4">
            <div className="rounded-lg border-2 border-muted-foreground/25 border-dashed p-2 sm:p-6">
              <Volume2 className="mx-auto size-8 text-muted-foreground sm:size-10" />
              <p className="mt-2 text-muted-foreground text-sm">
                Drop a radio station here
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
