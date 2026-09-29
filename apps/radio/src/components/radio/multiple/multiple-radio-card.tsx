/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { VolumeControl } from "@/components/audio/volume-control";
import type { Radio } from "@/lib/audio";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import type { MultipleSessionPlayerState } from "@/lib/hooks/use-multiple-session";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { InlineError } from "../inline-error";
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
  const { elementRef, hasEnteredViewport } =
    useHasEnteredViewport<HTMLDivElement>();
  const { metadata } = useRadioMetadata({
    enabled: isPlaying || hasEnteredViewport,
    poll: isPlaying && !isLoading,
    radio,
  });

  const handleVolumeChange = (value: number) => onVolumeChange(radio, value);
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
      data-radio-id={String(radio.id)}
      ref={elementRef}
    >
      {/* Header */}
      <div className="py-3 pr-12 pl-3">
        <RadioNowPlaying
          isLoading={isLoading}
          metadata={metadata}
          radio={radio}
        />
      </div>
      {/* Menu after the header so Tab reaches the station first */}
      <div className="absolute top-2 right-2">
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          radio={radio}
        />
      </div>

      {/* Error */}
      {error?.trim() ? (
        <InlineError className="mx-3 mb-2">{error}</InlineError>
      ) : null}

      {/* Controls */}
      <div className="mt-auto flex items-center gap-2 border-border/50 border-t px-3 py-2">
        <PlayPauseButton
          className="size-7 shrink-0"
          iconClassName="size-3.5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          label={radio.name}
          onClick={handleTogglePlayPause}
          size="sm"
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />
        <VolumeControl
          className="flex-1"
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          onVolumeChange={handleVolumeChange}
          target={radio.name}
          volume={volume}
        />
      </div>
    </div>
  );
}
