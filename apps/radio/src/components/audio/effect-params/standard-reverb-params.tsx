import {
  type EffectConfig,
  getEffectMetadata,
  type StandardReverbConfig,
} from "@avoid.quest/radio-audio";
import { ParamGroup, ParamSlider } from "./";

type StandardReverbParamsProps = {
  effect: StandardReverbConfig;
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

function handleWetChange(
  value: number,
  onUpdate: (config: Partial<EffectConfig>) => void
) {
  onUpdate({ wet: value, dry: 1 - value });
}

export function StandardReverbParams({
  effect,
  onUpdate,
}: StandardReverbParamsProps) {
  const metadata = getEffectMetadata("standardReverb");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;
  const disabled = !effect.enabled;

  return (
    <div className="space-y-4">
      <ParamGroup title="Room & Decay">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "roomSize")}
          disabled={disabled}
          formatKey="default"
          label="Room Size"
          max={ranges.roomSize?.max ?? 0.1}
          min={ranges.roomSize?.min ?? 0.01}
          onChange={(value) => onUpdate({ roomSize: value })}
          step={ranges.roomSize?.step ?? 0.001}
          value={effect.roomSize}
        />
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "decayTime")}
          disabled={disabled}
          formatKey="time"
          label="Decay Time"
          max={ranges.decayTime?.max ?? 5.0}
          min={ranges.decayTime?.min ?? 0.1}
          onChange={(value) => onUpdate({ decayTime: value })}
          step={ranges.decayTime?.step ?? 0.1}
          value={effect.decayTime}
        />
      </ParamGroup>

      <ParamGroup title="Mix">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "wet")}
          disabled={disabled}
          formatKey="percentage"
          label="Wet/Dry Mix"
          max={ranges.wet?.max ?? 1}
          min={ranges.wet?.min ?? 0}
          onChange={(value) => handleWetChange(value, onUpdate)}
          step={ranges.wet?.step ?? 0.01}
          value={effect.wet}
        />
      </ParamGroup>
    </div>
  );
}
