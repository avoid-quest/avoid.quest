import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { HeadphonesIcon } from "lucide-react";
import { SettingsButton } from "@/components/settings/settings-button";

type CueControlsProps = {
  headphoneVolume: number;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  onHeadphoneVolumeChange: (volume: number) => void;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

/**
 * CUE controls - deck CUE buttons and headphone volume
 */
export function CueControls({
  headphoneVolume,
  deckACueEnabled,
  deckBCueEnabled,
  onHeadphoneVolumeChange,
  onDeckACueChange,
  onDeckBCueChange,
}: CueControlsProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* CUE Buttons */}
      <div className="flex items-center justify-center gap-4">
        <Button
          className={cn(
            "h-8 w-16 font-bold text-xs",
            deckACueEnabled && "bg-orange-500 hover:bg-orange-600"
          )}
          onClick={() => onDeckACueChange(!deckACueEnabled)}
          size="sm"
          variant={deckACueEnabled ? "default" : "outline"}
        >
          CUE A
        </Button>
        <Button
          className={cn(
            "h-8 w-16 font-bold text-xs",
            deckBCueEnabled && "bg-orange-500 hover:bg-orange-600"
          )}
          onClick={() => onDeckBCueChange(!deckBCueEnabled)}
          size="sm"
          variant={deckBCueEnabled ? "default" : "outline"}
        >
          CUE B
        </Button>
        <SettingsButton />
      </div>

      {/* Headphone Volume */}
      <div className="flex items-center gap-2">
        <HeadphonesIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-muted-foreground text-xs">Phones</span>
        <Slider
          className="h-2 flex-1"
          max={100}
          min={0}
          onValueChange={([v]) => onHeadphoneVolumeChange(v / 100)}
          step={1}
          value={[headphoneVolume * 100]}
        />
        <span className="w-9 shrink-0 text-right font-mono text-muted-foreground text-xs">
          {Math.round(headphoneVolume * 100)}%
        </span>
      </div>
    </div>
  );
}
