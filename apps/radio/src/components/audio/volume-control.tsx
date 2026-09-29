/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react";

const QUIET_VOLUME = 0.5;

export type VolumeControlProps = {
  /** 0–1 */
  volume: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  /** Names what the control affects, e.g. "all" reads "Mute all". */
  target?: string;
  className?: string;
};

function getVolumeIcon(volume: number, isMuted: boolean) {
  if (isMuted || volume === 0) {
    return VolumeXIcon;
  }
  return volume < QUIET_VOLUME ? Volume1Icon : Volume2Icon;
}

/** The one mute button + volume slider pair outside the DJ mixer. */
export function VolumeControl({
  volume,
  isMuted,
  onToggleMute,
  onVolumeChange,
  target,
  className,
}: VolumeControlProps) {
  const VolumeIcon = getVolumeIcon(volume, isMuted);
  const suffix = target ? ` ${target}` : "";
  const handleValueChange = ([value]: number[]) => onVolumeChange(value ?? 0);

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Button
        aria-label={`${isMuted ? "Unmute" : "Mute"}${suffix}`}
        className="size-7 text-muted-foreground"
        onClick={onToggleMute}
        size="icon"
        variant="ghost"
      >
        <VolumeIcon />
      </Button>
      <Slider
        aria-label={`Volume${suffix}`}
        className="min-w-0 flex-1"
        defaultValue={[1]}
        max={1}
        min={0}
        onValueChange={handleValueChange}
        step={0.01}
        value={[isMuted ? 0 : volume]}
      />
    </div>
  );
}
