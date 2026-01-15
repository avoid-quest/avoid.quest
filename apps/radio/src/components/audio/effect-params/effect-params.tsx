import type { EffectConfig } from "@/lib/audio";
import { CompressorParams } from "./compressor-params";
import { DelayParams } from "./delay-params";
import { DistortionParams } from "./distortion-params";
import { PhaseVocoderParams } from "./phase-vocoder-params";
import { PlateReverbParams } from "./reverb-params";
import { StandardReverbParams } from "./standard-reverb-params";

type EffectParamsProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function EffectParams({ effect, onUpdate }: EffectParamsProps) {
  switch (effect.type) {
    case "plateReverb":
      return <PlateReverbParams effect={effect} onUpdate={onUpdate} />;
    case "standardReverb":
      return <StandardReverbParams effect={effect} onUpdate={onUpdate} />;
    case "phaseVocoder":
      return <PhaseVocoderParams effect={effect} onUpdate={onUpdate} />;
    case "delay":
      return <DelayParams effect={effect} onUpdate={onUpdate} />;
    case "distortion":
      return <DistortionParams effect={effect} onUpdate={onUpdate} />;
    case "compressor":
      return <CompressorParams effect={effect} onUpdate={onUpdate} />;
    default:
      return null;
  }
}
