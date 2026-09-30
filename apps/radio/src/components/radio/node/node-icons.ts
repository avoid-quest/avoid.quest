import {
  FilterIcon,
  type LucideIcon,
  MoveHorizontalIcon,
  RadioIcon,
  SpeakerIcon,
  Volume2Icon,
} from "lucide-react";
import { EFFECT_ICONS } from "@/components/audio/effect-constants";
import type { EffectType } from "@/lib/audio";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import type { NodeType } from "@/lib/node-graph/schema";

/**
 * The icon tile a node type wears on the canvas and in the palette. Effects
 * keep the icons the effect rack gives them; category reads from the tile,
 * never from a header colour.
 */
const NODE_ICONS: Partial<Record<NodeType, LucideIcon>> = {
  filter: FilterIcon,
  gain: Volume2Icon,
  pan: MoveHorizontalIcon,
  speakers: SpeakerIcon,
  station: RadioIcon,
};

export function nodeIcon(type: NodeType): LucideIcon {
  if (isEffectNodeType(type)) {
    return EFFECT_ICONS[type as EffectType] ?? FilterIcon;
  }
  return NODE_ICONS[type] ?? RadioIcon;
}
