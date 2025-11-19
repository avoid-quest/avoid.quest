import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type {
  EffectConfig,
  PlateReverbConfig,
} from "@/lib/audio/effects/types";
import { ParamGroup, ParamSlider } from "./";

type PlateReverbParamsProps = {
  effect: PlateReverbConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

type SliderConfig = {
  formatKey: string;
  key: keyof PlateReverbConfig;
  label: string;
  max: number;
  min: number;
  step: number;
};

type CreateSliderOptions = {
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
  disabled: boolean;
  effect: PlateReverbConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  sliderConfig: SliderConfig;
};

function createSlider({
  defaultConfig,
  disabled,
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

function PreDelayBandwidthGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PlateReverbConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "samples",
      key: "preDelay",
      label: "Pre-Delay",
      max: ranges.preDelay?.max ?? 47_999,
      min: ranges.preDelay?.min ?? 0,
      step: ranges.preDelay?.step ?? 1,
    },
    {
      formatKey: "default",
      key: "bandwidth",
      label: "Bandwidth",
      max: ranges.bandwidth?.max ?? 1,
      min: ranges.bandwidth?.min ?? 0,
      step: ranges.bandwidth?.step ?? 0.0001,
    },
  ];

  return (
    <ParamGroup title="Pre-Delay & Bandwidth">
      {sliders.map((slider) =>
        createSlider({
          defaultConfig,
          disabled,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

function InputDiffusionGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PlateReverbConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "default",
      key: "inputDiffusion1",
      label: "Input Diffusion 1",
      max: ranges.inputDiffusion1?.max ?? 1,
      min: ranges.inputDiffusion1?.min ?? 0,
      step: ranges.inputDiffusion1?.step ?? 0.01,
    },
    {
      formatKey: "default",
      key: "inputDiffusion2",
      label: "Input Diffusion 2",
      max: ranges.inputDiffusion2?.max ?? 1,
      min: ranges.inputDiffusion2?.min ?? 0,
      step: ranges.inputDiffusion2?.step ?? 0.01,
    },
  ];

  return (
    <ParamGroup title="Input Diffusion">
      {sliders.map((slider) =>
        createSlider({
          defaultConfig,
          disabled,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

function DecayGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PlateReverbConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "default",
      key: "decay",
      label: "Decay",
      max: ranges.decay?.max ?? 1,
      min: ranges.decay?.min ?? 0,
      step: ranges.decay?.step ?? 0.01,
    },
    {
      formatKey: "default",
      key: "decayDiffusion1",
      label: "Decay Diffusion 1",
      max: ranges.decayDiffusion1?.max ?? 0.999_999,
      min: ranges.decayDiffusion1?.min ?? 0,
      step: ranges.decayDiffusion1?.step ?? 0.001,
    },
    {
      formatKey: "default",
      key: "decayDiffusion2",
      label: "Decay Diffusion 2",
      max: ranges.decayDiffusion2?.max ?? 0.999_999,
      min: ranges.decayDiffusion2?.min ?? 0,
      step: ranges.decayDiffusion2?.step ?? 0.001,
    },
  ];

  return (
    <ParamGroup title="Decay">
      {sliders.map((slider) =>
        createSlider({
          defaultConfig,
          disabled,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

function ModulationGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PlateReverbConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "default",
      key: "damping",
      label: "Damping",
      max: ranges.damping?.max ?? 1,
      min: ranges.damping?.min ?? 0,
      step: ranges.damping?.step ?? 0.001,
    },
    {
      formatKey: "default",
      key: "excursionRate",
      label: "Excursion Rate",
      max: ranges.excursionRate?.max ?? 2,
      min: ranges.excursionRate?.min ?? 0,
      step: ranges.excursionRate?.step ?? 0.01,
    },
    {
      formatKey: "default",
      key: "excursionDepth",
      label: "Excursion Depth",
      max: ranges.excursionDepth?.max ?? 2,
      min: ranges.excursionDepth?.min ?? 0,
      step: ranges.excursionDepth?.step ?? 0.01,
    },
  ];

  return (
    <ParamGroup title="Modulation">
      {sliders.map((slider) =>
        createSlider({
          defaultConfig,
          disabled,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

function MixGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PlateReverbConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "percentage",
      key: "wet",
      label: "Wet",
      max: ranges.wet?.max ?? 1,
      min: ranges.wet?.min ?? 0,
      step: ranges.wet?.step ?? 0.01,
    },
    {
      formatKey: "percentage",
      key: "dry",
      label: "Dry",
      max: ranges.dry?.max ?? 1,
      min: ranges.dry?.min ?? 0,
      step: ranges.dry?.step ?? 0.01,
    },
  ];

  return (
    <ParamGroup title="Mix">
      {sliders.map((slider) =>
        createSlider({
          defaultConfig,
          disabled,
          effect,
          onUpdate,
          sliderConfig: slider,
        })
      )}
    </ParamGroup>
  );
}

export function PlateReverbParams({
  effect,
  isInitialized,
  onUpdate,
}: PlateReverbParamsProps) {
  const metadata = getEffectMetadata("plateReverb");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;
  const disabled = !(isInitialized && effect.enabled);

  return (
    <div className="space-y-4">
      <PreDelayBandwidthGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <InputDiffusionGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <DecayGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <ModulationGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <MixGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
    </div>
  );
}
