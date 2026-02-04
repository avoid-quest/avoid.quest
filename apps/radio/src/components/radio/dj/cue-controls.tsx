import { Button } from "@avoid.quest/ui/components/button";

type CueControlsProps = {
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

/**
 * CUE controls - deck CUE buttons
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
        className="h-8 w-16 font-bold text-xs"
        onClick={() => onDeckACueChange(!deckACueEnabled)}
        size="sm"
        variant={deckACueEnabled ? "default" : "outline"}
      >
        CUE A
      </Button>
      <Button
        className="h-8 w-16 font-bold text-xs"
        onClick={() => onDeckBCueChange(!deckBCueEnabled)}
        size="sm"
        variant={deckBCueEnabled ? "default" : "outline"}
      >
        CUE B
      </Button>
    </div>
  );
}
