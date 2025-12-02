import {
  type EffectConfig,
  getEffectMetadata,
  type PannerConfig,
} from "@avoid.quest/radio-audio";
import { ParamGroup, ParamSelect, ParamSlider, UniversalParams } from "./";

type PannerParamsProps = {
  effect: PannerConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

const DISTANCE_MODELS = [
  { value: "linear", label: "Linear" },
  { value: "inverse", label: "Inverse" },
  { value: "exponential", label: "Exponential" },
] as const;

const PANNING_MODELS = [
  { value: "equalpower", label: "Equal Power" },
  { value: "HRTF", label: "HRTF" },
] as const;

type SliderConfig = {
  formatKey: string;
  key: keyof PannerConfig;
  label: string;
  max: number;
  min: number;
  step: number;
};

type CreateSliderOptions = {
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
  disabled: boolean;
  effect: PannerConfig;
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

function BasicControls({ effect, onUpdate }: PannerParamsProps) {
  const disabled = !effect.enabled;
  return (
    <ParamGroup title="Basic">
      <ParamSelect
        disabled={disabled}
        label="Panning Model"
        onChange={(value) =>
          onUpdate({
            panningModel: value as PannerConfig["panningModel"],
          })
        }
        options={PANNING_MODELS}
        value={effect.panningModel}
      />

      <ParamSelect
        disabled={disabled}
        label="Distance Model"
        onChange={(value) =>
          onUpdate({
            distanceModel: value as PannerConfig["distanceModel"],
          })
        }
        options={DISTANCE_MODELS}
        value={effect.distanceModel}
      />
    </ParamGroup>
  );
}

function ConeGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PannerConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "degrees",
      key: "coneInnerAngle",
      label: "Cone Inner Angle",
      max: ranges.coneInnerAngle?.max ?? 360,
      min: ranges.coneInnerAngle?.min ?? 0,
      step: ranges.coneInnerAngle?.step ?? 1,
    },
    {
      formatKey: "degrees",
      key: "coneOuterAngle",
      label: "Cone Outer Angle",
      max: ranges.coneOuterAngle?.max ?? 360,
      min: ranges.coneOuterAngle?.min ?? 0,
      step: ranges.coneOuterAngle?.step ?? 1,
    },
    {
      formatKey: "default",
      key: "coneOuterGain",
      label: "Cone Outer Gain",
      max: ranges.coneOuterGain?.max ?? 1,
      min: ranges.coneOuterGain?.min ?? 0,
      step: ranges.coneOuterGain?.step ?? 0.01,
    },
  ];

  return (
    <ParamGroup title="Cone">
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

function DistanceGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PannerConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "distance",
      key: "maxDistance",
      label: "Max Distance",
      max: ranges.maxDistance?.max ?? 100_000,
      min: ranges.maxDistance?.min ?? 0,
      step: ranges.maxDistance?.step ?? 1,
    },
    {
      formatKey: "distance",
      key: "refDistance",
      label: "Ref Distance",
      max: ranges.refDistance?.max ?? 1000,
      min: ranges.refDistance?.min ?? 0,
      step: ranges.refDistance?.step ?? 0.1,
    },
    {
      formatKey: "default",
      key: "rolloffFactor",
      label: "Rolloff Factor",
      max: ranges.rolloffFactor?.max ?? 10,
      min: ranges.rolloffFactor?.min ?? 0,
      step: ranges.rolloffFactor?.step ?? 0.1,
    },
  ];

  return (
    <ParamGroup title="Distance">
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

function PositionGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PannerConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "distance",
      key: "positionX",
      label: "Position X",
      max: ranges.positionX?.max ?? 1000,
      min: ranges.positionX?.min ?? -1000,
      step: ranges.positionX?.step ?? 0.1,
    },
    {
      formatKey: "distance",
      key: "positionY",
      label: "Position Y",
      max: ranges.positionY?.max ?? 1000,
      min: ranges.positionY?.min ?? -1000,
      step: ranges.positionY?.step ?? 0.1,
    },
    {
      formatKey: "distance",
      key: "positionZ",
      label: "Position Z",
      max: ranges.positionZ?.max ?? 1000,
      min: ranges.positionZ?.min ?? -1000,
      step: ranges.positionZ?.step ?? 0.1,
    },
  ];

  return (
    <ParamGroup title="Position">
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

function OrientationGroup({
  effect,
  disabled,
  onUpdate,
  ranges,
  defaultConfig,
}: {
  effect: PannerConfig;
  disabled: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  ranges: Record<string, { max?: number; min?: number; step?: number }>;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
}) {
  const sliders: SliderConfig[] = [
    {
      formatKey: "default",
      key: "orientationX",
      label: "Orientation X",
      max: ranges.orientationX?.max ?? 1,
      min: ranges.orientationX?.min ?? -1,
      step: ranges.orientationX?.step ?? 0.01,
    },
    {
      formatKey: "default",
      key: "orientationY",
      label: "Orientation Y",
      max: ranges.orientationY?.max ?? 1,
      min: ranges.orientationY?.min ?? -1,
      step: ranges.orientationY?.step ?? 0.01,
    },
    {
      formatKey: "default",
      key: "orientationZ",
      label: "Orientation Z",
      max: ranges.orientationZ?.max ?? 1,
      min: ranges.orientationZ?.min ?? -1,
      step: ranges.orientationZ?.step ?? 0.01,
    },
  ];

  return (
    <ParamGroup title="Orientation">
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

export function PannerParams({ effect, onUpdate }: PannerParamsProps) {
  const metadata = getEffectMetadata("panner");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;
  const disabled = !effect.enabled;

  return (
    <div className="space-y-4">
      <BasicControls effect={effect} onUpdate={onUpdate} />
      <ConeGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <DistanceGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <PositionGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />
      <OrientationGroup
        defaultConfig={defaultConfig}
        disabled={disabled}
        effect={effect}
        onUpdate={onUpdate}
        ranges={ranges}
      />

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
