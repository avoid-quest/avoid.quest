"use client";

import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type { DelayConfig, EffectConfig } from "@/lib/audio/effects/types";
import { ParamGroup, ParamSlider } from "./";

type DelayParamsProps = {
  effect: DelayConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function DelayParams({
  effect,
  isInitialized,
  onUpdate,
}: DelayParamsProps) {
  const metadata = getEffectMetadata("delay");
  const ranges = metadata?.parameterRanges ?? {};

  return (
    <div className="space-y-4">
      <ParamSlider
        disabled={!(isInitialized && effect.enabled)}
        formatKey="time"
        label="Delay Time"
        max={ranges.delayTime?.max ?? 1}
        min={ranges.delayTime?.min ?? 0}
        onChange={(value) => onUpdate({ delayTime: value })}
        step={ranges.delayTime?.step ?? 0.01}
        value={effect.delayTime}
      />

      <ParamSlider
        disabled={!(isInitialized && effect.enabled)}
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
          disabled={!(isInitialized && effect.enabled)}
          formatKey="percentage"
          label="Wet"
          max={ranges.wet?.max ?? 1}
          min={ranges.wet?.min ?? 0}
          onChange={(value) => {
            onUpdate({ wet: value, dry: 1 - value });
          }}
          step={ranges.wet?.step ?? 0.01}
          value={effect.wet}
        />
      </ParamGroup>
    </div>
  );
}
