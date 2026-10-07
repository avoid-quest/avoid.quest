import {
  ActivityIcon,
  ArrowLeftRightIcon,
  AudioLinesIcon,
  ClockIcon,
  FileAudioIcon,
  FilterIcon,
  type LucideIcon,
  MergeIcon,
  MicIcon,
  MonitorSpeakerIcon,
  MoveHorizontalIcon,
  MusicIcon,
  PianoIcon,
  RadioIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  SpeakerIcon,
  SplitIcon,
  Volume2Icon,
  WavesIcon,
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
  clock: ClockIcon,
  curve: ActivityIcon,
  deviceIn: MicIcon,
  deviceOut: MonitorSpeakerIcon,
  envelope: ActivityIcon,
  file: FileAudioIcon,
  filter: FilterIcon,
  follower: ActivityIcon,
  frequencySplit: AudioLinesIcon,
  fxComposite: SplitIcon,
  gain: Volume2Icon,
  lfo: WavesIcon,
  macro: SlidersHorizontalIcon,
  merge: MergeIcon,
  midiIn: PianoIcon,
  multiEnvelope: ActivityIcon,
  pan: MoveHorizontalIcon,
  platform: MusicIcon,
  randomiser: ShuffleIcon,
  shapedLfo: WavesIcon,
  slew: MoveHorizontalIcon,
  speakers: SpeakerIcon,
  station: RadioIcon,
  steps: AudioLinesIcon,
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
