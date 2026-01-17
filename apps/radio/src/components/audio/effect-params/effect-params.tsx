import type { EffectConfig } from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import { DeclarativeParams } from "./declarative-params";

type EffectParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function EffectParams({ effect, onUpdate }: EffectParamsProps) {
  const schema = getEffectSchema(effect.type);

  if (!schema) {
    return null;
  }

  return (
    <DeclarativeParams effect={effect} onUpdate={onUpdate} schema={schema} />
  );
}
