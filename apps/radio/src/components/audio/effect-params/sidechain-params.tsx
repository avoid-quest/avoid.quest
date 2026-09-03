import { Label } from "@avoid.quest/ui/components/label";
import type { EffectConfig } from "@/lib/audio";

type SidechainParamsProps = {
  deckId?: "deck-a" | "deck-b";
  effect: Extract<EffectConfig, { type: "compressor" | "gate" | "vocoder" }>;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function SidechainParams({
  deckId,
  effect,
  onUpdate,
}: SidechainParamsProps) {
  if (
    !deckId ||
    (effect.type === "vocoder" &&
      effect.modulatorSource !== "external" &&
      effect.modulator !== "external")
  ) {
    return null;
  }

  const otherDeck = deckId === "deck-a" ? "deck-b" : "deck-a";
  const id = `${effect.id}-sidechain`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Sidechain input</Label>
      <select
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        id={id}
        onChange={(event) =>
          onUpdate({
            sidechain: event.target.value
              ? { channelId: event.target.value }
              : undefined,
          } as Partial<EffectConfig>)
        }
        value={effect.sidechain?.channelId ?? ""}
      >
        <option value="">Internal input</option>
        <option value={otherDeck}>
          {otherDeck === "deck-a" ? "Deck A" : "Deck B"}
        </option>
      </select>
      <p className="text-muted-foreground text-xs">
        The other live deck is routed into the detector/modulator in-browser.
      </p>
    </div>
  );
}
