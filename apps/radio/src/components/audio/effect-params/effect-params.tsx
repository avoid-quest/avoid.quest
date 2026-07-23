import type { EffectConfig } from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import { ContainerParams } from "./container-params";
import { DeclarativeParams } from "./declarative-params";
import { SidechainParams } from "./sidechain-params";
import { Tone3000ModelParams } from "./tone3000-model-params";
import { WerkstattParams } from "./werkstatt-params";

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

  if (
    effect.type === "fxComposite" ||
    effect.type === "stereoSplit" ||
    effect.type === "frequencySplit"
  ) {
    return (
      <ContainerParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        onUpdate={onUpdate}
      />
    );
  }

  return (
    <div className="space-y-4">
      <DeclarativeParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        onUpdate={onUpdate}
        schema={schema}
      />
      {(effect.type === "compressor" ||
        effect.type === "gate" ||
        effect.type === "vocoder") && (
        <SidechainParams deckId={deckId} effect={effect} onUpdate={onUpdate} />
      )}
      {effect.type === "werkstatt" && (
        <WerkstattParams effect={effect} onUpdate={onUpdate} />
      )}
      {effect.type === "neuralAmp" && (
        <Tone3000ModelParams effect={effect} onUpdate={onUpdate} />
      )}
    </div>
  );
}
