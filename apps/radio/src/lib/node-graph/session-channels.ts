/**
 * Node Session Channels
 *
 * In the node session, `channels` is a cache derived from the compiled plan:
 * one channel per lane, id `n:<nodeId>`, role "node", carrying the lane's
 * radio, volume, mute, pan, filter and lowered FX tree. It is written with
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
 * not own (dry/wet, speed, cue…) carry over from `previous`.
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
      effects: lane.effects,
      filter: lane.filter
        ? { ...lane.filter, enabled: true, gain: 0 }
        : { ...base.filter, enabled: false },
      id: lane.channelId,
      muted: lane.muted,
      order,
      pan: lane.pan,
      radio: lane.radio as PlaybackChannelRecord["radio"],
      role: "node",
      volume: lane.volume,
    };
  });
}
