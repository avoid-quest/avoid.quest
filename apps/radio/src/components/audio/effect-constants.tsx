import type { EffectType } from "@avoid.quest/radio-audio";
import {
  Clock,
  Filter,
  FireExtinguisher,
  Radio,
  Waves,
  Zap,
} from "lucide-react";

export const EFFECT_ICONS: Record<EffectType, typeof Filter> = {
  biquadFilter: Filter,
  plateReverb: Waves,
  standardReverb: Waves,
  phaseVocoder: Radio,
  delay: Clock,
  distortion: Zap,
  compressor: FireExtinguisher,
  panner: Radio,
};
