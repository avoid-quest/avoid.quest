import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { cn } from "@avoid.quest/ui/lib/utils";
import { HeadphonesIcon } from "lucide-react";

type CueControlsProps = {
  className?: string;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  cueBlend: number;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
  onCueBlendChange: (blend: number) => void;
};

/**
 * CUE monitoring controls for DJ headphone preview.
 * - CUE buttons enable pre-fader listening for each deck
 * - CUE/MIX blend slider controls the mix in headphones
 */
export function CueControls({
  className,
  deckACueEnabled,
  deckBCueEnabled,
  cueBlend,
  onDeckACueChange,
  onDeckBCueChange,
  onCueBlendChange,
}: CueControlsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Deck A CUE button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              "h-7 gap-1 px-2",
              deckACueEnabled && "bg-amber-600 hover:bg-amber-700"
            )}
            onClick={() => onDeckACueChange(!deckACueEnabled)}
            size="sm"
            variant={deckACueEnabled ? "default" : "outline"}
          >
            <HeadphonesIcon className="size-3.5" />
            <span className="font-bold text-xs">A</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>CUE Deck A (pre-fader listen)</p>
        </TooltipContent>
      </Tooltip>

      {/* CUE/MIX blend slider */}
      <div className="flex flex-1 items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">CUE</span>
        <Slider
          className="h-1.5 flex-1"
          max={100}
          min={0}
          onValueChange={([v]) => onCueBlendChange(v / 100)}
          step={1}
          value={[cueBlend * 100]}
        />
        <span className="text-[10px] text-muted-foreground">MIX</span>
      </div>

      {/* Deck B CUE button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              "h-7 gap-1 px-2",
              deckBCueEnabled && "bg-amber-600 hover:bg-amber-700"
            )}
            onClick={() => onDeckBCueChange(!deckBCueEnabled)}
            size="sm"
            variant={deckBCueEnabled ? "default" : "outline"}
          >
            <HeadphonesIcon className="size-3.5" />
            <span className="font-bold text-xs">B</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>CUE Deck B (pre-fader listen)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
