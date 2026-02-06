import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useState } from "react";
import type { MultipleAudioState, Radio } from "@/lib/audio";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";

type MultipleRadioCardProps = {
  radio: Radio;
  playerState: MultipleAudioState | null;
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
};

export function MultipleRadioCard({
  radio,
  playerState,
  onTogglePlayPause,
  onVolumeChange,
  onEdit,
  onDelete,
  onToggle,
}: MultipleRadioCardProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [unmutedVolume, setUnmutedVolume] = useState(1);

  const isPlaying = playerState?.isPlaying ?? false;
  const isLoading = playerState?.isLoading ?? false;
  const volume = playerState?.volume ?? 1;
  const error = playerState?.error ?? null;

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0] ?? 0;
    onVolumeChange(newVolume);

    if (isMuted && newVolume > 0) {
      setUnmutedVolume(newVolume);
      setIsMuted(false);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      onVolumeChange(unmutedVolume);
      setIsMuted(false);
    } else {
      setUnmutedVolume(volume);
      onVolumeChange(0);
      setIsMuted(true);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border/50 bg-card/50 transition-colors",
        isPlaying && "border-primary/20"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <RadioLogo logoUrl={radio.logoUrl} name={radio.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-sm leading-tight">
            {radio.name}
          </p>
        </div>
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onToggle={onToggle}
          radio={radio}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 rounded-md bg-destructive/10 px-2 py-1">
          <p className="font-mono text-[10px] text-destructive">{error}</p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 border-border/50 border-t px-3 py-2">
        <PlayPauseButton
          className="size-7 shrink-0"
          iconClassName="size-3.5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          onClick={onTogglePlayPause}
          size="sm"
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />
        <button
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          onClick={handleMuteToggle}
          type="button"
        >
          {isMuted || volume === 0 ? (
            <VolumeXIcon className="size-3" />
          ) : (
            <Volume2Icon className="size-3" />
          )}
        </button>
        <Slider
          className="h-1.5 flex-1"
          defaultValue={[1]}
          max={1}
          min={0}
          onValueChange={handleVolumeChange}
          step={0.01}
          value={[volume]}
        />
        <span className="w-7 shrink-0 text-right font-mono text-[10px] text-muted-foreground/60 tabular-nums">
          {Math.round(volume * 100)}
        </span>
      </div>
    </div>
  );
}
