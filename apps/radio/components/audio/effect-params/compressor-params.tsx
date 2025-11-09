"use client";

import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type { CompressorConfig, EffectConfig } from "@/lib/audio/effects/types";
import { ParamGroup, ParamSlider } from "./";

type CompressorParamsProps = {
  effect: CompressorConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

type SliderConfig = {
  formatKey: string;
  key: keyof CompressorConfig;
  label: string;
  max: number;
  min: number;
  step: number;
};

function createSlider(
  sliderConfig: SliderConfig,
  effect: CompressorConfig,
  disabled: boolean,
  onUpdate: (config: Partial<EffectConfig>) => void
) {
  return (
    <ParamSlider
      disabled={disabled}
      formatKey={sliderConfig.formatKey}
      key={sliderConfig.key}
      label={sliderConfig.label}
      max={sliderConfig.max}
      min={sliderConfig.min}
      onChange={(value) => onUpdate({ [sliderConfig.key]: value })}
      step={sliderConfig.step}
      value={effect[sliderConfig.key] as number}
    />
  );
}

function ThresholdRatioGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
}: {
  effect: CompressorConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "db",
      key: "threshold",
      label: "Threshold",
      max: ranges.threshold?.max ?? 0,
      min: ranges.threshold?.min ?? -100,
      step: ranges.threshold?.step ?? 1,
    },
    {
      formatKey: "ratio",
      key: "ratio",
      label: "Ratio",
      max: ranges.ratio?.max ?? 20,
      min: ranges.ratio?.min ?? 1,
      step: ranges.ratio?.step ?? 0.1,
    },
  ];

  return (
    <ParamGroup title="Threshold & Ratio">
      {sliders.map((slider) =>
        createSlider(slider, effect, disabled, onUpdate)
      )}
    </ParamGroup>
  );
}

function TimingGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
}: {
  effect: CompressorConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "timeMs",
      key: "attack",
      label: "Attack",
      max: ranges.attack?.max ?? 1,
      min: ranges.attack?.min ?? 0,
      step: ranges.attack?.step ?? 0.001,
    },
    {
      formatKey: "timeMs",
      key: "release",
      label: "Release",
      max: ranges.release?.max ?? 1,
      min: ranges.release?.min ?? 0,
      step: ranges.release?.step ?? 0.001,
    },
  ];

  return (
    <ParamGroup title="Timing">
      {sliders.map((slider) =>
        createSlider(slider, effect, disabled, onUpdate)
      )}
    </ParamGroup>
  );
}

export function CompressorParams({
  effect,
  isInitialized,
  onUpdate,
}: CompressorParamsProps) {
  const metadata = getEffectMetadata("compressor");
  const ranges = metadata?.parameterRanges ?? {};
  const disabled = !(isInitialized && effect.enabled);

  return (
    <div className="space-y-4">
      <ThresholdRatioGroup
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <TimingGroup
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      {createSlider(
        {
          formatKey: "db",
          key: "knee",
          label: "Knee",
          max: ranges.knee?.max ?? 40,
          min: ranges.knee?.min ?? 0,
          step: ranges.knee?.step ?? 1,
        },
        effect,
        disabled,
        onUpdate
      )}
    </div>
  );
}
