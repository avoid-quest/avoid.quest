import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconArrowMerge,
  IconArrowsHorizontal,
  IconArrowsLeftRight,
  IconArrowsShuffle,
  IconArrowsSplit,
  IconClock,
  IconDeviceSpeaker,
  IconFileMusic,
  IconFilter,
  IconMicrophone,
  IconMusic,
  IconPiano,
  IconRadio,
  IconSpeakerphone,
  IconVolume,
  IconWaveSine,
  type TablerIcon,
} from "@tabler/icons-react";
import { EFFECT_ICONS } from "@/components/audio/effect-constants";
import type { EffectType } from "@/lib/audio";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import type { NodeType } from "@/lib/node-graph/schema";

/**
 * The icon tile a node type wears on the canvas and in the palette. Effects
 * keep the icons the effect rack gives them, but the splits and Merge read
 * as routing; category reads from the tile, never from a header colour.
 */
const NODE_ICONS: Partial<Record<NodeType, TablerIcon>> = {
  clock: IconClock,
  curve: IconActivity,
  deviceIn: IconMicrophone,
  deviceOut: IconDeviceSpeaker,
  envelope: IconActivity,
  file: IconFileMusic,
  filter: IconFilter,
  follower: IconActivity,
  frequencySplit: IconWaveSine,
  fxComposite: IconArrowsSplit,
  gain: IconVolume,
  lfo: IconWaveSine,
  macro: IconAdjustmentsHorizontal,
  merge: IconArrowMerge,
  midiIn: IconPiano,
  multiEnvelope: IconActivity,
  pan: IconArrowsHorizontal,
  platform: IconMusic,
  randomiser: IconArrowsShuffle,
  shapedLfo: IconWaveSine,
  slew: IconArrowsHorizontal,
  speakers: IconSpeakerphone,
  station: IconRadio,
  steps: IconWaveSine,
  stereoSplit: IconArrowsLeftRight,
};

export function nodeIcon(type: NodeType): TablerIcon {
  const own = NODE_ICONS[type];
  if (own) {
    return own;
  }
  if (isEffectNodeType(type)) {
    return EFFECT_ICONS[type as EffectType] ?? IconFilter;
  }
  return IconRadio;
}
