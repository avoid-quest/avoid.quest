/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react";

const MAX_VOLUME = 100;

const VOLUME_THRESHOLD = 0.5;

export type VolumeControlProps = {
  volume: number;
  onVolumeChange: (volume: number) => void;
  className?: string;
  showIcon?: boolean;
  showMute?: boolean;
  size?: "sm" | "md" | "lg";
  orientation?: "horizontal" | "vertical";
  defaultValue?: number;
};

export function VolumeControl({
  volume,
  onVolumeChange,
  className,
  showIcon = true,
  showMute = true,
  size = "md",
  orientation = "horizontal",
  defaultValue = 1,
}: VolumeControlProps) {
  function handleSliderChange(value: number[]) {
    onVolumeChange((value[0] ?? 0) / MAX_VOLUME);
  }

  function handleMute() {
    onVolumeChange(volume > 0 ? 0 : 1);
  }

  const getVolumeIcon = () => {
    if (volume === 0) {
      return VolumeXIcon;
    }
    if (volume < VOLUME_THRESHOLD) {
      return Volume1Icon;
    }
    return Volume2Icon;
  };

  const VolumeIcon = getVolumeIcon();

  const sizeClasses = {
    lg: "h-10 w-10",
    md: "h-8 w-8",
    sm: "h-6 w-6",
  };

  const sliderSizeClasses = {
    lg: "h-3",
    md: "h-2",
    sm: "h-1",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        orientation === "vertical" && "flex-col",
        className
      )}
    >
      {showIcon.valueOf() && (
        <Button
          className={cn(
            "p-0",
            sizeClasses[size],
            showMute.valueOf() && "hover:bg-muted"
          )}
          onClick={handleMute}
          size="sm"
          variant="ghost"
        >
          <VolumeIcon className={cn("h-4 w-4", size === "lg" && "h-5 w-5")} />
        </Button>
      )}

      <div className={cn("flex-1", orientation === "vertical" && "w-full")}>
        <Slider
          className={cn(
            sliderSizeClasses[size],
            orientation === "vertical" && "h-24"
          )}
          defaultValue={[defaultValue * MAX_VOLUME]}
          max={MAX_VOLUME}
          min={0}
          onValueChange={handleSliderChange}
          orientation={orientation}
          step={1}
          value={[volume * MAX_VOLUME]}
        />
      </div>

      {!showMute && showIcon && (
        <span className="min-w-8 text-center text-muted-foreground text-xs">
          {Math.round(volume * MAX_VOLUME)}%
        </span>
      )}
    </div>
  );
}
