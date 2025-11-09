"use client";

import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type { DistortionConfig, EffectConfig } from "@/lib/audio/effects/types";
import { ParamSelect, ParamSlider } from "./";

type DistortionParamsProps = {
  effect: DistortionConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

const OVERSAMPLE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "2x", label: "2x" },
  { value: "4x", label: "4x" },
] as const;

export function DistortionParams({
  effect,
  isInitialized,
  onUpdate,
}: DistortionParamsProps) {
  const metadata = getEffectMetadata("distortion");
  const ranges = metadata?.parameterRanges ?? {};

  return (
    <div className="space-y-4">
      <ParamSlider
        disabled={!(isInitialized && effect.enabled)}
        formatKey="default"
        formatter={(value) => `${Math.round(value)}%`}
        label="Amount"
        max={ranges.amount?.max ?? 100}
        min={ranges.amount?.min ?? 0}
        onChange={(value) => onUpdate({ amount: value })}
        step={ranges.amount?.step ?? 1}
        value={effect.amount}
      />

      <ParamSelect
        disabled={!isInitialized}
        label="Oversample"
        onChange={(value) =>
          onUpdate({
            oversample: value as DistortionConfig["oversample"],
          })
        }
        options={OVERSAMPLE_OPTIONS}
        value={effect.oversample}
      />
    </div>
  );
}
