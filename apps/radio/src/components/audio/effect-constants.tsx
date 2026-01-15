import {
  ClockIcon,
  FilterIcon,
  FireExtinguisherIcon,
  RadioIcon,
  WavesIcon,
  ZapIcon,
} from "lucide-react";
import type { EffectType } from "@/lib/audio";

export const EFFECT_ICONS: Record<EffectType, typeof FilterIcon> = {
  biquadFilter: FilterIcon,
  plateReverb: WavesIcon,
  standardReverb: WavesIcon,
  phaseVocoder: RadioIcon,
  delay: ClockIcon,
  distortion: ZapIcon,
  compressor: FireExtinguisherIcon,
  crusher: ZapIcon,
  fold: ZapIcon,
  stereoTool: RadioIcon,
  revamp: FilterIcon,
  tidal: WavesIcon,
};
