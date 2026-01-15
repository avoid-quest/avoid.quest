import {
  type EffectConfig,
  getEffectMetadata,
  type PhaseVocoderConfig,
} from "@/lib/audio";
import { ParamGroup, ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type PhaseVocoderParamsProps = {
  effect: PhaseVocoderConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function PhaseVocoderParams({
  effect,
  onUpdate,
}: PhaseVocoderParamsProps) {
  const metadata = getEffectMetadata("phaseVocoder");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamGroup title="Pitch">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "pitchFactor")}
          formatKey="default"
          label="Pitch Factor"
          max={ranges.pitchFactor?.max ?? 4.0}
          min={ranges.pitchFactor?.min ?? 0.25}
          onChange={(value) => onUpdate({ pitchFactor: value })}
          step={ranges.pitchFactor?.step ?? 0.01}
          value={effect.pitchFactor}
        />
      </ParamGroup>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
