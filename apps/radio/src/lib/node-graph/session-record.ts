import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/routing/effect-tree";
import type {
  PlaybackChannelRecord,
  PlaybackSessionRecord,
} from "@/lib/collections/playback-sessions";
import type { NodeGraph } from "./schema";

/** A stored Node session; channel derivation belongs to its graph builder. */
export function nodeSessionRecord(
  graph: NodeGraph,
  channels: PlaybackChannelRecord[] = [],
  masterVolume = 1
): PlaybackSessionRecord {
  return {
    activeChannelId: null,
    channels,
    crossfadePosition: 0.5,
    graph,
    headphoneVolume: 1,
    id: "node",
    masterVolume,
    tempo: DEFAULT_EFFECT_TEMPO,
  };
}
