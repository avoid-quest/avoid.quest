/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import type { EffectConfig } from "@/lib/audio";
import {
  getEffectDefaultConfig,
  UNIVERSAL_EFFECT_PARAM_DEFS,
} from "@/lib/audio/dsp/effects/schema";
import { ParamGroup, ParamSlider } from "./";

type UniversalParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
  midiTargetPrefix?: string;
};

type UniversalParam = (typeof UNIVERSAL_EFFECT_PARAM_DEFS)[number];

function UniversalParamSlider({
  defaultConfig,
  midiTargetPrefix,
  onUpdate,
  param,
  value,
}: {
  defaultConfig: ReturnType<typeof getEffectDefaultConfig>;
  midiTargetPrefix?: string;
  onUpdate: (config: Partial<EffectConfig>) => void;
  param: UniversalParam;
  value: number;
}) {
  function updateValue(nextValue: number) {
    onUpdate({ [param.key]: nextValue });
  }
  const defaultValue = defaultConfig
    ? (defaultConfig as Record<string, unknown>)[param.key]
    : undefined;
  const slider = (
    <ParamSlider
      defaultValue={typeof defaultValue === "number" ? defaultValue : undefined}
      description={param.description}
      formatKey={param.formatKey ?? "default"}
      label={param.label}
      max={param.max}
      min={param.min}
      onChange={updateValue}
      step={param.step}
      value={value}
    />
  );

  if (!midiTargetPrefix) {
    return slider;
  }

  return (
    <MidiControlWrapper targetId={`${midiTargetPrefix}:${param.key}`}>
      {slider}
    </MidiControlWrapper>
  );
}

export function UniversalParams({
  effect,
  onUpdate,
  deckId,
  effectId,
  midiTargetPrefix,
}: UniversalParamsProps) {
  const defaultConfig = getEffectDefaultConfig(effect.type);
  const targetPrefix =
    midiTargetPrefix ??
    (deckId && effectId ? `${deckId}:effect:${effectId}` : undefined);

  return (
    <ParamGroup title="Wrapper">
      {UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => {
        const value = (effect as unknown as Record<string, unknown>)[param.key];
        if (typeof value !== "number") {
          return null;
        }

        return (
          <UniversalParamSlider
            defaultConfig={defaultConfig}
            key={param.key}
            midiTargetPrefix={targetPrefix}
            onUpdate={onUpdate}
            param={param}
            value={value}
          />
        );
      })}
    </ParamGroup>
  );
}
