import {
  type CompressorConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@avoid.quest/radio-audio";
import { ParamGroup, ParamSlider, UniversalParams } from "./";

type CompressorParamsProps = {
  effect: CompressorConfig;
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

type CreateSliderOptions = {
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
  effect: CompressorConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  sliderConfig: SliderConfig;
};

function createSlider({
  defaultConfig,
  effect,
  onUpdate,
  sliderConfig,
}: CreateSliderOptions) {
  const defaultValue = defaultConfig
    ? ((defaultConfig as Record<string, unknown>)[sliderConfig.key] as
        | number
        | undefined)
    : undefined;

  return (
    <ParamSlider
      defaultValue={defaultValue}
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
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: CompressorConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
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
        createSlider({
          defaultConfig,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

function TimingGroup({
  effect,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: CompressorConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
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
        createSlider({
          defaultConfig,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

export function CompressorParams({ effect, onUpdate }: CompressorParamsProps) {
  const metadata = getEffectMetadata("compressor");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ThresholdRatioGroup
        defaultConfig={defaultConfig}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <TimingGroup
        defaultConfig={defaultConfig}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      {createSlider({
        defaultConfig,
        effect,
        onUpdate,
        sliderConfig: {
          formatKey: "db",
          key: "knee",
          label: "Knee",
          max: ranges.knee?.max ?? 40,
          min: ranges.knee?.min ?? 0,
          step: ranges.knee?.step ?? 1,
        },
      })}

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
