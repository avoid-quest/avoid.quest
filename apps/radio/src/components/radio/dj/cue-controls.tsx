import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";

type CueControlsProps = {
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

/**
 * CUE controls - deck CUE buttons with deck-specific colors (blue A, amber B)
 */
export function CueControls({
  deckACueEnabled,
  deckBCueEnabled,
  onDeckACueChange,
  onDeckBCueChange,
}: CueControlsProps) {
  return (
    <div className="flex items-center justify-center gap-4">
      <Button
        className={cn(
          "h-8 w-16 font-bold text-xs",
          deckACueEnabled && "bg-blue-500 hover:bg-blue-600"
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
          deckBCueEnabled && "bg-amber-500 hover:bg-amber-600"
        )}
        onClick={() => onDeckBCueChange(!deckBCueEnabled)}
        size="sm"
        variant={deckBCueEnabled ? "default" : "outline"}
      >
        CUE B
      </Button>
    </div>
  );
}
