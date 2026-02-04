import type { EffectConfig } from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import { DeclarativeParams } from "./declarative-params";

type EffectParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
};

export function EffectParams({
  effect,
  onUpdate,
  deckId,
  effectId,
}: EffectParamsProps) {
  const schema = getEffectSchema(effect.type);

  if (!schema) {
    return null;
  }

  return (
    <DeclarativeParams
      deckId={deckId}
      effect={effect}
      effectId={effectId}
      onUpdate={onUpdate}
      schema={schema}
    />
  );
}
