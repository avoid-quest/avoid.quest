import { type EffectConfig, getEffectMetadata } from "@/lib/audio";
import { ParamGroup, ParamSlider } from "./";

function getDefaultValue(
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined,
  key: string
): number | undefined {
  if (!defaultConfig) {
    return undefined;
  }
  const value = (defaultConfig as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

type UniversalParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function UniversalParams({ effect, onUpdate }: UniversalParamsProps) {
  const metadata = getEffectMetadata(effect.type);
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <ParamGroup>
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "dryWet")}
        description="Effect Mix: 0% = dry (bypassed), 100% = fully wet (full effect)"
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
