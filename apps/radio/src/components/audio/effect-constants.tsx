import type { EffectType } from "@avoid.quest/radio-audio";
import {
  ClockIcon,
  FilterIcon,
  FireExtinguisherIcon,
  RadioIcon,
  WavesIcon,
  ZapIcon,
} from "lucide-react";

export const EFFECT_ICONS: Record<EffectType, typeof FilterIcon> = {
  plateReverb: WavesIcon,
  standardReverb: WavesIcon,
  phaseVocoder: RadioIcon,
  delay: ClockIcon,
  distortion: ZapIcon,
  compressor: FireExtinguisherIcon,
  panner: RadioIcon,
  crusher: ZapIcon,
  fold: ZapIcon,
  stereoTool: RadioIcon,
  revamp: FilterIcon,
  tidal: WavesIcon,
};
