"use client";

import type { EffectConfig } from "@/lib/audio/effects/types";
import { BiquadFilterParams } from "./biquad-filter-params";
import { CompressorParams } from "./compressor-params";
import { DelayParams } from "./delay-params";
import { DistortionParams } from "./distortion-params";
import { PannerParams } from "./panner-params";
import { ReverbParams } from "./reverb-params";

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
    case "reverb":
      return (
        <ReverbParams
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
