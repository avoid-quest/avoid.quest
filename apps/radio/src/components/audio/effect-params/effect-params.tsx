import type { EffectConfig, RevampConfig } from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import { ContainerParams } from "./container-params";
import { DeclarativeParams } from "./declarative-params";
import { EFFECT_LAYOUTS } from "./effect-layouts";
import { RevampParams } from "./revamp-params";
import { SidechainParams } from "./sidechain-params";
import { TailoredParams } from "./tailored-params";
import { Tone3000ModelParams } from "./tone3000-model-params";
import { WerkstattParams } from "./werkstatt-params";

type EffectParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
  /**
   * Where MIDI learn targets start, e.g. `node:<nodeId>` in Node mode. DJ
   * decks leave it unset and get `<deckId>:effect:<effectId>`.
   */
  midiTargetPrefix?: string;
};

export function EffectParams({
  effect,
  onUpdate,
  deckId,
  effectId,
  midiTargetPrefix,
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
        midiTargetPrefix={midiTargetPrefix}
        onUpdate={onUpdate}
      />
    );
  }

  const layout = EFFECT_LAYOUTS[effect.type];
  let params: React.ReactNode;
  if (effect.type === "revamp") {
    params = (
      <RevampParams
        deckId={deckId}
        effect={effect as RevampConfig}
        effectId={effectId}
        midiTargetPrefix={midiTargetPrefix}
        onUpdate={onUpdate}
      />
    );
  } else if (layout) {
    params = (
      <TailoredParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        layout={layout}
        midiTargetPrefix={midiTargetPrefix}
        onUpdate={onUpdate}
        schema={schema}
      />
    );
  } else {
    params = (
      <DeclarativeParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        midiTargetPrefix={midiTargetPrefix}
        onUpdate={onUpdate}
        schema={schema}
      />
    );
  }

  return (
    <div className="space-y-4">
      {params}
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
