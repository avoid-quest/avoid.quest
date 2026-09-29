import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";

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
  onVolumeChange: (value: number[]) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Button
        className="h-8 gap-2 text-xs"
        onClick={onTogglePlayback}
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

      <div className="flex items-center gap-2">
        <button
          aria-label={globalMuted ? "Unmute all" : "Mute all"}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleMute}
          type="button"
        >
          {globalMuted ? (
            <VolumeXIcon className="size-4" />
          ) : (
            <Volume2Icon className="size-4" />
          )}
        </button>
        <div className="w-32 shrink-0">
          <Slider
            className="h-2"
            defaultValue={[1]}
            max={1}
            min={0}
            onValueChange={onVolumeChange}
            step={0.01}
            value={[globalVolume]}
          />
        </div>
      </div>
    </div>
  );
}
