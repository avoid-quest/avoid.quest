import {
  type EffectConfig,
  getEffectMetadata,
  type LimiterConfig,
} from "@/lib/audio";
import { ParamGroup, ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type LimiterParamsProps = {
  effect: LimiterConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function LimiterParams({ effect, onUpdate }: LimiterParamsProps) {
  const metadata = getEffectMetadata("limiter");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamGroup title="Limiter">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "threshold")}
          formatKey="db"
          label="Threshold"
          max={ranges.threshold?.max ?? 0}
          min={ranges.threshold?.min ?? -60}
          onChange={(value) => onUpdate({ threshold: value })}
          step={ranges.threshold?.step ?? 0.1}
          value={effect.threshold}
        />
      </ParamGroup>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
