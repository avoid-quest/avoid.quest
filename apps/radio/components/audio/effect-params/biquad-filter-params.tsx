"use client";

import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type {
  BiquadFilterConfig,
  EffectConfig,
} from "@/lib/audio/effects/types";
import { ParamSelect, ParamSlider } from "./";

const FILTER_TYPES = [
  { value: "lowpass", label: "Low Pass" },
  { value: "highpass", label: "High Pass" },
  { value: "bandpass", label: "Band Pass" },
  { value: "lowshelf", label: "Low Shelf" },
  { value: "highshelf", label: "High Shelf" },
  { value: "peaking", label: "Peaking" },
  { value: "notch", label: "Notch" },
  { value: "allpass", label: "All Pass" },
] as const;

type BiquadFilterParamsProps = {
  effect: BiquadFilterConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function BiquadFilterParams({
  effect,
  isInitialized,
  onUpdate,
}: BiquadFilterParamsProps) {
  const metadata = getEffectMetadata("biquadFilter");
  const ranges = metadata?.parameterRanges ?? {};

  const showGain =
    effect.filterType === "lowshelf" ||
    effect.filterType === "highshelf" ||
    effect.filterType === "peaking";

  return (
    <div className="space-y-4">
      <ParamSelect
        disabled={!isInitialized}
        label="Filter Type"
        onChange={(value) =>
          onUpdate({ filterType: value as BiquadFilterConfig["filterType"] })
        }
        options={FILTER_TYPES}
        value={effect.filterType}
      />

      <ParamSlider
        disabled={!(isInitialized && effect.enabled)}
        formatKey="frequency"
        label="Frequency"
        max={ranges.frequency?.max ?? 20_000}
        min={ranges.frequency?.min ?? 20}
        onChange={(value) => onUpdate({ frequency: value })}
        step={ranges.frequency?.step ?? 1}
        value={effect.frequency}
      />

      <ParamSlider
        disabled={!(isInitialized && effect.enabled)}
        formatKey="default"
        label="Q (Resonance)"
        max={ranges.Q?.max ?? 30}
        min={ranges.Q?.min ?? 0.1}
        onChange={(value) => onUpdate({ Q: value })}
        step={ranges.Q?.step ?? 0.1}
        value={effect.Q}
      />

      {showGain && (
        <ParamSlider
          disabled={!(isInitialized && effect.enabled)}
          formatKey="gain"
          label="Gain"
          max={ranges.gain?.max ?? 40}
          min={ranges.gain?.min ?? -40}
          onChange={(value) => onUpdate({ gain: value })}
          step={ranges.gain?.step ?? 0.1}
          value={effect.gain}
        />
      )}
    </div>
  );
}
