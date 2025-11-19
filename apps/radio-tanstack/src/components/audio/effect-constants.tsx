import {
  Clock,
  Filter,
  FireExtinguisher,
  Radio,
  Waves,
  Zap,
} from "lucide-react";
import type { EffectType } from "@/lib/audio/effects/types";

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
