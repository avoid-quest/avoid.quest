import {
  type DelayConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@avoid.quest/radio-audio";
import { ParamSlider, UniversalParams } from "./";

type DelayParamsProps = {
  effect: DelayConfig;
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

export function DelayParams({ effect, onUpdate }: DelayParamsProps) {
  const metadata = getEffectMetadata("delay");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "delayTime")}
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
        formatKey="percentage"
        label="Feedback"
        max={ranges.feedback?.max ?? 0.95}
        min={ranges.feedback?.min ?? 0}
        onChange={(value) => onUpdate({ feedback: value })}
        step={ranges.feedback?.step ?? 0.01}
        value={effect.feedback}
      />

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
