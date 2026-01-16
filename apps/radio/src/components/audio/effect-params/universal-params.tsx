import type { EffectConfig } from "@/lib/audio";
import { ParamGroup, ParamSlider } from "./";

/**
 * Universal parameter ranges (same for all effects).
 * These are not in the per-effect schema since they apply universally.
 */
const UNIVERSAL_RANGES = {
  dryWet: { min: 0, max: 1, step: 0.01, default: 1.0 },
  inputGain: { min: 0, max: 4.0, step: 0.01, default: 1.0 },
  outputGain: { min: 0, max: 4.0, step: 0.01, default: 1.0 },
} as const;

type UniversalParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function UniversalParams({ effect, onUpdate }: UniversalParamsProps) {
  return (
    <ParamGroup>
      <ParamSlider
        defaultValue={UNIVERSAL_RANGES.dryWet.default}
        description="Effect Mix: 0% = dry (bypassed), 100% = fully wet (full effect)"
        formatKey="percentage"
        label="Dry/Wet"
        max={UNIVERSAL_RANGES.dryWet.max}
        min={UNIVERSAL_RANGES.dryWet.min}
        onChange={(value) => onUpdate({ dryWet: value })}
        step={UNIVERSAL_RANGES.dryWet.step}
        value={effect.dryWet}
      />
      <ParamSlider
        defaultValue={UNIVERSAL_RANGES.inputGain.default}
        formatKey="linearGain"
        label="Input Gain"
        max={UNIVERSAL_RANGES.inputGain.max}
        min={UNIVERSAL_RANGES.inputGain.min}
        onChange={(value) => onUpdate({ inputGain: value })}
        step={UNIVERSAL_RANGES.inputGain.step}
        value={effect.inputGain}
      />
      <ParamSlider
        defaultValue={UNIVERSAL_RANGES.outputGain.default}
        formatKey="linearGain"
        label="Output Gain"
        max={UNIVERSAL_RANGES.outputGain.max}
        min={UNIVERSAL_RANGES.outputGain.min}
        onChange={(value) => onUpdate({ outputGain: value })}
        step={UNIVERSAL_RANGES.outputGain.step}
        value={effect.outputGain}
      />
    </ParamGroup>
  );
}
