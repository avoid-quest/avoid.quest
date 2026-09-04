/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import type { MultipleSessionPlayerState } from "@/lib/hooks/use-multiple-session";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { RadioItemActions } from "../radio-item-actions";
import { RadioNowPlaying } from "../radio-now-playing";

type MultipleRadioCardProps = {
  radio: Radio;
  playerState: MultipleSessionPlayerState | null;
  onTogglePlayPause: (radio: Radio) => void;
  onToggleMute: (radio: Radio) => void;
  onVolumeChange: (radio: Radio, volume: number) => void;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  onSave?: (radio: Radio) => void;
};

export function MultipleRadioCard({
  radio,
  playerState,
  onTogglePlayPause,
  onToggleMute,
  onVolumeChange,
  onEdit,
  onDelete,
  onToggle,
  onSave,
}: MultipleRadioCardProps) {
  const isPlaying = playerState?.isPlaying ?? false;
  const isLoading = playerState?.isLoading ?? false;
  const volume = playerState?.volume ?? 1;
  const isMuted = playerState?.isMuted ?? volume === 0;
  const error = playerState?.error ?? null;
  const { metadata } = useRadioMetadata({
    poll: isPlaying && !isLoading,
    radio,
  });

  const handleVolumeChange = (value: number[]) =>
    onVolumeChange(radio, value[0] ?? 0);
  const handleTogglePlayPause = () => onTogglePlayPause(radio);
  const handleToggleMute = () => onToggleMute(radio);

  const isSession = isSessionRadio(radio);

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border border-border/50 bg-card/50 transition-colors",
        isPlaying && !isLoading && "border-foreground/40",
        isSession && "border-l-2 border-l-[#00d084]/40"
      )}
    >
      <div className="absolute top-2 right-2">
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          radio={radio}
        />
      </div>
      {/* Header */}
      <div className="py-3 pr-12 pl-3">
        <RadioNowPlaying
          isLoading={isLoading}
          metadata={metadata}
          radio={radio}
        />
      </div>

      {/* Error */}
      {error ? (
        <div className="mx-3 mb-2 rounded-md bg-destructive/10 px-2 py-1">
          <p className="font-mono text-[10px] text-destructive">{error}</p>
        </div>
      ) : null}

      {/* Controls */}
      <div className="mt-auto flex items-center gap-2 border-border/50 border-t px-3 py-2">
        <PlayPauseButton
          className="size-7 shrink-0"
          iconClassName="size-3.5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          onClick={handleTogglePlayPause}
          size="sm"
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />
        <button
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          onClick={handleToggleMute}
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
