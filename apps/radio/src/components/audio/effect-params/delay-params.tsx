import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type { DelayConfig, EffectConfig } from "@/lib/audio/effects/types";
import { ParamGroup, ParamSlider } from "./";

type DelayParamsProps = {
  effect: DelayConfig;
  isInitialized: boolean;
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

export function DelayParams({
  effect,
  isInitialized,
  onUpdate,
}: DelayParamsProps) {
  const metadata = getEffectMetadata("delay");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;
  const disabled = !(isInitialized && effect.enabled);

  return (
    <div className="space-y-4">
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "delayTime")}
        disabled={disabled}
        formatKey="time"
        label="Delay Time"
        max={ranges.delayTime?.max ?? 1}
        min={ranges.delayTime?.min ?? 0}
        onChange={(value) => onUpdate({ delayTime: value })}
        step={ranges.delayTime?.step ?? 0.01}
        value={effect.delayTime}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "feedback")}
        disabled={disabled}
        formatKey="percentage"
        label="Feedback"
        max={ranges.feedback?.max ?? 0.95}
        min={ranges.feedback?.min ?? 0}
        onChange={(value) => onUpdate({ feedback: value })}
        step={ranges.feedback?.step ?? 0.01}
        value={effect.feedback}
      />

      <ParamGroup title="Mix">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "wet")}
          disabled={disabled}
          formatKey="percentage"
          label="Wet"
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
