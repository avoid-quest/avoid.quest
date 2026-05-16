import { Badge } from "@avoid.quest/ui/components/badge";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import type { MultipleSessionPlayerState } from "@/lib/hooks/use-multiple-session";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";
import { RadioNowPlaying } from "../radio-now-playing";

type MultipleRadioCardProps = {
  radio: Radio;
  playerState: MultipleSessionPlayerState | null;
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  onSave?: (radio: Radio) => void;
};

export function MultipleRadioCard({
  radio,
  playerState,
  onTogglePlayPause,
  onVolumeChange,
  onEdit,
  onDelete,
  onToggle,
  onSave,
}: MultipleRadioCardProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [unmutedVolume, setUnmutedVolume] = useState(1);

  const isPlaying = playerState?.isPlaying ?? false;
  const isLoading = playerState?.isLoading ?? false;
  const volume = playerState?.volume ?? 1;
  const error = playerState?.error ?? null;
  const { metadata } = useRadioMetadata({ radio, enabled: isPlaying });

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

  const isSession = isSessionRadio(radio);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border/50 bg-card/50 transition-colors",
        isPlaying && "border-primary/20",
        isSession && "border-l-2 border-l-[#00d084]/40"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <RadioLogo logoUrl={radio.logoUrl} name={radio.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-semibold text-sm leading-tight">
              {radio.name}
            </p>
            {isSession && (
              <Badge
                className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
                variant="outline"
              >
                Unsaved
              </Badge>
            )}
          </div>
          {radio.placeTitle ? (
            <p className="truncate text-muted-foreground/60 text-xs leading-snug">
              {radio.placeTitle}, {radio.countryTitle}
            </p>
          ) : (
            radio.description && (
              <p className="truncate text-muted-foreground/60 text-xs leading-snug">
                {radio.description}
              </p>
            )
          )}
          {isPlaying && (
            <RadioNowPlaying className="truncate" metadata={metadata} />
          )}
        </div>
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
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
