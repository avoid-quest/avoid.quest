import { Button } from "@avoid.quest/ui/components/button";

type MixerCueProps = {
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

export function MixerCue({
  deckACueEnabled,
  deckBCueEnabled,
  onDeckACueChange,
  onDeckBCueChange,
}: MixerCueProps) {
  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        className="h-7 w-14 font-bold font-mono text-[10px] uppercase tracking-wider"
        onClick={() => onDeckACueChange(!deckACueEnabled)}
        size="sm"
        variant={deckACueEnabled ? "default" : "outline"}
      >
        CUE A
      </Button>
      <Button
        className="h-7 w-14 font-bold font-mono text-[10px] uppercase tracking-wider"
        onClick={() => onDeckBCueChange(!deckBCueEnabled)}
        size="sm"
        variant={deckBCueEnabled ? "default" : "outline"}
      >
        CUE B
      </Button>
    </div>
  );
}
