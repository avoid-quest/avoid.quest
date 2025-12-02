import { type EffectConfig, getEffectMetadata } from "@avoid.quest/radio-audio";
import { ParamGroup, ParamSlider } from "./";

type UniversalParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

function getDefaultValue(
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined,
  key: string
): number | undefined {
  if (!defaultConfig) {
    return;
  }
  if (!(key in defaultConfig)) {
    return;
  }
  const value = (defaultConfig as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

export function UniversalParams({ effect, onUpdate }: UniversalParamsProps) {
  const metadata = getEffectMetadata(effect.type);
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;
  const disabled = !effect.enabled;

  return (
    <ParamGroup title="Universal Controls">
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "dryWet")}
        disabled={disabled}
        formatKey="percentage"
        label="Dry/Wet"
        max={ranges.dryWet?.max ?? 1}
        min={ranges.dryWet?.min ?? 0}
        onChange={(value) => onUpdate({ dryWet: value })}
        step={ranges.dryWet?.step ?? 0.01}
        value={effect.dryWet}
      />
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "inputGain")}
        disabled={disabled}
        formatKey="linearGain"
        label="Input Gain"
        max={ranges.inputGain?.max ?? 4.0}
        min={ranges.inputGain?.min ?? 0}
        onChange={(value) => onUpdate({ inputGain: value })}
        step={ranges.inputGain?.step ?? 0.01}
        value={effect.inputGain}
      />
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "outputGain")}
        disabled={disabled}
        formatKey="linearGain"
        label="Output Gain"
        max={ranges.outputGain?.max ?? 4.0}
        min={ranges.outputGain?.min ?? 0}
        onChange={(value) => onUpdate({ outputGain: value })}
        step={ranges.outputGain?.step ?? 0.01}
        value={effect.outputGain}
      />
    </ParamGroup>
  );
}
