/**
 * Node Session Channels
 *
 * In the node session, `channels` is a cache derived from the compiled plan:
 * one channel per lane, id `n:<nodeId>`, role "node", carrying the lane's
 * radio, volume, mute, pan, filter, lowered FX tree and, from its strip,
 * speed, repeat (loop) and cue listen. It is written with
 * the graph in the same update, so restore, channel effects and NAM
 * externalisation keep working on it unchanged.
 */

import {
  createDefaultChannel,
  type PlaybackChannelRecord,
} from "@/lib/collections/playback-sessions";
import type { EnginePlan } from "./compile";

/**
 * Channels for every lane in `plan`, in lane order. Fields the graph does
 * not own (dry/wet, autoplay…) carry over from `previous`.
 */
export function deriveNodeChannels(
  plan: Pick<EnginePlan, "lanes">,
  previous: readonly PlaybackChannelRecord[] = []
): PlaybackChannelRecord[] {
  const previousById = new Map(
    previous.map((channel) => [channel.id, channel])
  );
  return [...plan.lanes.values()].map((lane, order) => {
    const base =
      previousById.get(lane.channelId) ??
      createDefaultChannel(lane.channelId, "node", order);
    return {
      ...base,
      cueEnabled: lane.cueListen,
      effects: lane.effects,
      filter: lane.filter
        ? { ...lane.filter, enabled: true, gain: 0 }
        : { ...base.filter, enabled: false },
      id: lane.channelId,
      muted: lane.muted,
      order,
      pan: lane.pan,
      radio: lane.radio as PlaybackChannelRecord["radio"],
      repeat: lane.transport?.loop ?? false,
      role: "node",
      speed: lane.transport?.speed ?? 1,
      volume: lane.volume,
    };
  });
}
