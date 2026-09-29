import { Button } from "@avoid.quest/ui/components/button";
import { PauseIcon, PlayIcon } from "lucide-react";
import { VolumeControl } from "@/components/audio/volume-control";

export function MultipleGlobalControls({
  isAnyPlaying,
  playingCount,
  totalCount,
  globalMuted,
  globalVolume,
  onTogglePlayback,
  onToggleMute,
  onVolumeChange,
}: {
  isAnyPlaying: boolean;
  playingCount: number;
  totalCount: number;
  globalMuted: boolean;
  globalVolume: number;
  onTogglePlayback: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
}) {
  return (
    <div className="flex w-full shrink-0 items-center gap-3 sm:w-auto">
      <Button
        className="text-xs"
        onClick={onTogglePlayback}
        size="sm"
        variant="outline"
      >
        {isAnyPlaying ? (
          <>
            <PauseIcon className="size-3.5" />
            Pause all ({playingCount})
          </>
        ) : (
          <>
            <PlayIcon className="size-3.5" />
            Play all ({totalCount})
          </>
        )}
      </Button>

      <VolumeControl
        className="flex-1 sm:w-40 sm:flex-none"
        isMuted={globalMuted}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
        target="all"
        volume={globalVolume}
      />
    </div>
  );
}
