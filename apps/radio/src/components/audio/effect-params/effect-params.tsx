import type { EffectConfig } from "@/lib/audio";
import { BiquadFilterParams } from "./biquad-filter-params";
import { CompressorParams } from "./compressor-params";
import { CrusherParams } from "./crusher-params";
import { DelayParams } from "./delay-params";
import { DistortionParams } from "./distortion-params";
import { FoldParams } from "./fold-params";
import { LimiterParams } from "./limiter-params";
import { PitchShifterParams } from "./pitch-shifter-params";
import { RevampParams } from "./revamp-params";
import { PlateReverbParams } from "./reverb-params";
import { StereoToolParams } from "./stereo-tool-params";
import { TidalParams } from "./tidal-params";

type EffectParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function EffectParams({ effect, onUpdate }: EffectParamsProps) {
  switch (effect.type) {
    case "biquadFilter":
      return <BiquadFilterParams effect={effect} onUpdate={onUpdate} />;
    case "plateReverb":
      return <PlateReverbParams effect={effect} onUpdate={onUpdate} />;
    case "pitchShifter":
      return <PitchShifterParams effect={effect} onUpdate={onUpdate} />;
    case "delay":
      return <DelayParams effect={effect} onUpdate={onUpdate} />;
    case "distortion":
      return <DistortionParams effect={effect} onUpdate={onUpdate} />;
    case "compressor":
      return <CompressorParams effect={effect} onUpdate={onUpdate} />;
    case "crusher":
      return <CrusherParams effect={effect} onUpdate={onUpdate} />;
    case "fold":
      return <FoldParams effect={effect} onUpdate={onUpdate} />;
    case "stereoTool":
      return <StereoToolParams effect={effect} onUpdate={onUpdate} />;
    case "revamp":
      return <RevampParams effect={effect} onUpdate={onUpdate} />;
    case "tidal":
      return <TidalParams effect={effect} onUpdate={onUpdate} />;
    case "limiter":
      return <LimiterParams effect={effect} onUpdate={onUpdate} />;
    default:
      return null;
  }
}
