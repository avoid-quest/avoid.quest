/**
 * Node Session Bootstrap
 *
 * Until the Multiple → Node migration lands, a node session is created on
 * first use from the "Start from Multiple" template: every enabled saved
 * station, then the session stations, at their Multiple volumes and master.
 * An existing node session is never touched.
 */

import type { Radio } from "@/lib/audio/playback/types";
import {
  getMultipleChannelId,
  getPlaybackSession,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { radiosCollection } from "@/lib/collections/radios";
import { getSessionRadios } from "@/lib/collections/session-radios";
import { buildNodeSessionFromTemplate } from "./templates";

export function ensureNodePlaybackSession(): void {
  if (getPlaybackSession("node")) {
    return;
  }
  const multiple = getPlaybackSession("multiple");
  const levels = (radio: Radio) => {
    const channel = multiple?.channels.find(
      (entry) => entry.id === getMultipleChannelId(radio)
    );
    return channel
      ? { muted: channel.muted, volume: channel.volume }
      : undefined;
  };
  playbackSessionsCollection.insert(
    buildNodeSessionFromTemplate("start-from-multiple", {
      levels,
      masterVolume: multiple?.masterVolume,
      saved: [...radiosCollection.state.values()] as Radio[],
      session: getSessionRadios(),
    })
  );
}
