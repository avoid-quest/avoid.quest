import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type {
  EffectConfig,
  PhaseVocoderConfig,
} from "@/lib/audio/effects/types";
import { ParamGroup, ParamSlider } from "./";

type PhaseVocoderParamsProps = {
  effect: PhaseVocoderConfig;
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

export function PhaseVocoderParams({
  effect,
  onUpdate,
}: PhaseVocoderParamsProps) {
  const metadata = getEffectMetadata("phaseVocoder");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;
  const disabled = !effect.enabled;

  return (
    <div className="space-y-4">
      <ParamGroup title="Pitch">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "pitchFactor")}
          disabled={disabled}
          formatKey="default"
          label="Pitch Factor"
          max={ranges.pitchFactor?.max ?? 4.0}
          min={ranges.pitchFactor?.min ?? 0.25}
          onChange={(value) => onUpdate({ pitchFactor: value })}
          step={ranges.pitchFactor?.step ?? 0.01}
          value={effect.pitchFactor}
        />
      </ParamGroup>
    </div>
  );
}
