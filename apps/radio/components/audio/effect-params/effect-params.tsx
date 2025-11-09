"use client";

import type { EffectConfig } from "@/lib/audio/effects/types";
import { BiquadFilterParams } from "./biquad-filter-params";
import { CompressorParams } from "./compressor-params";
import { DelayParams } from "./delay-params";
import { DistortionParams } from "./distortion-params";
import { PannerParams } from "./panner-params";
import { PhaseVocoderParams } from "./phase-vocoder-params";
import { PlateReverbParams } from "./reverb-params";
import { StandardReverbParams } from "./standard-reverb-params";

type EffectParamsProps = {
  effect: EffectConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function EffectParams({
  effect,
  isInitialized,
  onUpdate,
}: EffectParamsProps) {
  switch (effect.type) {
    case "biquadFilter":
      return (
        <BiquadFilterParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "plateReverb":
      return (
        <PlateReverbParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "standardReverb":
      return (
        <StandardReverbParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "phaseVocoder":
      return (
        <PhaseVocoderParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "delay":
      return (
        <DelayParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "distortion":
      return (
        <DistortionParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "compressor":
      return (
        <CompressorParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    case "panner":
      return (
        <PannerParams
          effect={effect}
          isInitialized={isInitialized}
          onUpdate={onUpdate}
        />
      );
    default:
      return null;
  }
}
