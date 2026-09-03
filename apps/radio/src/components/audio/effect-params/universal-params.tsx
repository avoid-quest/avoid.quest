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

export function UniversalParams({
  effect,
  onUpdate,
  deckId,
  effectId,
  midiTargetPrefix,
}: UniversalParamsProps) {
  const defaultConfig = getEffectDefaultConfig(effect.type);

  const wrapSlider = (paramKey: string, slider: React.ReactNode) => {
    const targetPrefix =
      midiTargetPrefix ??
      (deckId && effectId ? `${deckId}:effect:${effectId}` : undefined);
    if (targetPrefix) {
      return (
        <MidiControlWrapper
          key={paramKey}
          targetId={`${targetPrefix}:${paramKey}`}
        >
          {slider}
        </MidiControlWrapper>
      );
    }
    return slider;
  };

  return (
    <ParamGroup title="Wrapper">
      {UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => {
        const value = (effect as unknown as Record<string, unknown>)[param.key];
        if (typeof value !== "number") {
          return null;
        }

        const defaultValue = defaultConfig
          ? (defaultConfig as Record<string, unknown>)[param.key]
          : undefined;

        return wrapSlider(
          param.key,
          <ParamSlider
            defaultValue={
              typeof defaultValue === "number" ? defaultValue : undefined
            }
            description={param.description}
            formatKey={param.formatKey ?? "default"}
            key={param.key}
            label={param.label}
            max={param.max}
            min={param.min}
            onChange={(value) => onUpdate({ [param.key]: value })}
            step={param.step}
            value={value}
          />
        );
      })}
    </ParamGroup>
  );
}
