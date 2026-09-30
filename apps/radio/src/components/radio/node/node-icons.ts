import {
  ArrowLeftRightIcon,
  AudioLinesIcon,
  FileAudioIcon,
  FilterIcon,
  type LucideIcon,
  MergeIcon,
  MicIcon,
  MonitorSpeakerIcon,
  MoveHorizontalIcon,
  MusicIcon,
  RadioIcon,
  SpeakerIcon,
  SplitIcon,
  Volume2Icon,
} from "lucide-react";
import { EFFECT_ICONS } from "@/components/audio/effect-constants";
import type { EffectType } from "@/lib/audio";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import type { NodeType } from "@/lib/node-graph/schema";

/**
 * The icon tile a node type wears on the canvas and in the palette. Effects
 * keep the icons the effect rack gives them, but the splits and Merge read
 * as routing; category reads from the tile, never from a header colour.
 */
const NODE_ICONS: Partial<Record<NodeType, LucideIcon>> = {
  deviceIn: MicIcon,
  deviceOut: MonitorSpeakerIcon,
  file: FileAudioIcon,
  filter: FilterIcon,
  frequencySplit: AudioLinesIcon,
  fxComposite: SplitIcon,
  gain: Volume2Icon,
  merge: MergeIcon,
  pan: MoveHorizontalIcon,
  platform: MusicIcon,
  speakers: SpeakerIcon,
  station: RadioIcon,
  stereoSplit: ArrowLeftRightIcon,
};

export function nodeIcon(type: NodeType): LucideIcon {
  const own = NODE_ICONS[type];
  if (own) {
    return own;
  }
  if (isEffectNodeType(type)) {
    return EFFECT_ICONS[type as EffectType] ?? FilterIcon;
  }
  return RadioIcon;
}
