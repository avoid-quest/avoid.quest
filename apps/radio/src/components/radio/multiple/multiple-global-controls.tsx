import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";

export function MultipleGlobalControls({
  isAnyPlaying,
  globalMuted,
  globalVolume,
  onTogglePlayback,
  onToggleMute,
  onVolumeChange,
}: {
  isAnyPlaying: boolean;
  globalMuted: boolean;
  globalVolume: number;
  onTogglePlayback: () => void;
  onToggleMute: () => void;
  onVolumeChange: (value: number[]) => void;
}) {
  return (
    <div className="mb-4 flex shrink-0 items-center gap-4 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
      <Button
        className="h-9 gap-2 text-sm"
        onClick={onTogglePlayback}
        variant="outline"
      >
        {isAnyPlaying ? (
          <>
            <PauseIcon className="size-4" />
            Pause All
          </>
        ) : (
          <>
            <PlayIcon className="size-4" />
            Play All
          </>
        )}
      </Button>

      <div className="h-5 w-px bg-border/50" />

      <div className="flex flex-1 items-center gap-2.5">
        <button
          aria-label={globalMuted ? "Unmute all" : "Mute all"}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          onClick={onToggleMute}
          type="button"
        >
          {globalMuted ? (
            <VolumeXIcon className="size-4" />
          ) : (
            <Volume2Icon className="size-4" />
          )}
        </button>
        <Slider
          className="h-2 max-w-xs flex-1"
          defaultValue={[1]}
          max={1}
          min={0}
          onValueChange={onVolumeChange}
          step={0.01}
          value={[globalVolume]}
        />
        <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
          {Math.round(globalVolume * 100)}%
        </span>
      </div>
    </div>
  );
}
