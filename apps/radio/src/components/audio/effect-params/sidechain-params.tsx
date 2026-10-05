/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import type { EffectConfig } from "@/lib/audio";
import { ParamSelect } from "./param-select";

type SidechainParamsProps = {
  deckId?: "deck-a" | "deck-b";
  effect: Extract<EffectConfig, { type: "compressor" | "gate" | "vocoder" }>;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

/** Radix Select items cannot use an empty value, so the internal input gets a name. */
const INTERNAL_INPUT = "internal";

export function SidechainParams({
  deckId,
  effect,
  onUpdate,
}: SidechainParamsProps) {
  function handleSidechainChange(value: string) {
    onUpdate({
      sidechain: value === INTERNAL_INPUT ? undefined : { channelId: value },
    } as Partial<EffectConfig>);
  }

  if (
    !deckId ||
    (effect.type === "vocoder" &&
      effect.modulatorSource !== "external" &&
      effect.modulator !== "external")
  ) {
    return null;
  }

  const otherDeck = deckId === "deck-a" ? "deck-b" : "deck-a";

  return (
    <div className="space-y-1">
      <ParamSelect
        label="Sidechain input"
        onChange={handleSidechainChange}
        options={[
          { label: "Internal input", value: INTERNAL_INPUT },
          {
            label: otherDeck === "deck-a" ? "Deck A" : "Deck B",
            value: otherDeck,
          },
        ]}
        value={effect.sidechain?.channelId ?? INTERNAL_INPUT}
      />
      <p className="text-muted-foreground text-xs">
        The other live deck is routed into the detector/modulator in-browser.
      </p>
    </div>
  );
}
