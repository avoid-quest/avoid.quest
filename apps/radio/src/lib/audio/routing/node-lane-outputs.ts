/**
 * Node Lane Outputs
 *
 * One stable `laneOut` GainNode per node lane, between the lane sound's
 * fader and everything its cables reach, fanned out into one send per
 * cable (sends.ts):
 *
 *   nodes.gain (fader) → laneOut → send(cable) → an Output node's gain
 *                                → send(cable) → a shared unit or module
 *
 * The fader belongs to the volume controller, so node code never writes
 * it. Each send's gain is its cable's level; laneOut carries only the
 * layout duck. Where a send goes is the `route` callback's call, by the
 * cable's destination. A cable that goes, or moves, fades out and is let
 * go, and a released lane lets go of every send, once its own fade-out is
 * over.
 *
 * laneOut is built inside the lane's output connector, which AudioManager
 * calls synchronously while it connects the sound's native shell, so it
 * exists before any await of the play gesture. Every send starts silent
 * and ramps to its level.
 */

import type { AudioManager } from "../manager/audio-manager.js";
import type { SoundOutputConnector } from "../manager/audio-manager-types.js";
import { safeDisconnect, safeDisconnectFrom } from "../utils.js";
import {
  delay,
  LANE_DUCK_MS,
  rampGain,
  type SendPlan,
  Sends,
} from "./sends.js";

export type LaneOutputHost = Pick<AudioManager, "setSoundOutputConnector">;

/**
 * Connects one send to its destination and returns its disconnect. A
 * realtime lane (a live input) skips the main delay.
 */
export type LaneSinkRoute = (
  to: string,
  send: AudioNode,
  realtime: boolean
) => () => void;

export type NodeLaneOutputsOptions = {
  /** Read at attach time: the default context's AudioManager can be reset. */
  getHost: () => LaneOutputHost;
  /** The lane's cables now, by cable id. */
  getSends: (laneId: string) => ReadonlyMap<string, SendPlan>;
  route: LaneSinkRoute;
  /**
   * Runs as the lane's sound connects, before its effects do: its native
   * nodes exist from here, in `context`, and its playback has not started.
   */
  onConnect?: (laneId: string, context: BaseAudioContext) => void;
  wait?: (ms: number) => Promise<void>;
};

export type NodeLaneOutputs = {
  /**
   * Registers the lane's connector for `soundId`. Call it before the sound
   * plays; it is a no-op while the same sound is attached.
   */
  attach: (laneId: string, soundId: string) => void;
  /**
   * Ramps each of the lane's sends to its cable's level; a cable that went
   * fades out and is let go.
   */
  refresh: (laneId: string) => void;
  /**
   * The layout duck: ramps laneOut to 0 and resolves once it is silent;
   * null without a laneOut. The lane swaps its tree, then unducks.
   */
  duck: (laneId: string) => Promise<void> | null;
  /** Ramps laneOut back from the layout duck. */
  unduck: (laneId: string) => void;
  /** Unregisters the connector and drops laneOut. Its sound is gone. */
  release: (laneId: string) => void;
  dispose: () => void;
};

type LaneOutput = {
  soundId: string;
  host: LaneOutputHost;
  out: GainNode | null;
  sends: Sends | null;
  /** Under a layout duck: a rebuilt laneOut starts silent too. */
  ducked: boolean;
};

export function createNodeLaneOutputs({
  getHost,
  getSends,
  onConnect,
  route,
  wait = delay,
}: NodeLaneOutputsOptions): NodeLaneOutputs {
  const lanes = new Map<string, LaneOutput>();

  const dropOut = (lane: LaneOutput) => {
    lane.sends?.drop();
    lane.sends = null;
    safeDisconnect(lane.out, "NodeLaneOutputs.release");
    lane.out = null;
  };

  const ensureOut = (lane: LaneOutput, context: BaseAudioContext) => {
    if (lane.out?.context === context) {
      return lane.out;
    }
    dropOut(lane);
    const out = context.createGain();
    out.gain.value = lane.ducked ? 0 : 1;
    lane.out = out;
    lane.sends = new Sends(out, route, wait);
    return out;
  };

  const connectorFor =
    (laneId: string, lane: LaneOutput): SoundOutputConnector =>
    (source) => {
      onConnect?.(laneId, source.context);
      const out = ensureOut(lane, source.context);
      source.connect(out);
      lane.sends?.settle(getSends(laneId));
      return () => {
        safeDisconnectFrom(source, out, "NodeLaneOutputs.disconnect");
      };
    };

  const release = (laneId: string) => {
    const lane = lanes.get(laneId);
    if (!lane) {
      return;
    }
    lanes.delete(laneId);
    lane.host.setSoundOutputConnector(lane.soundId, null);
    dropOut(lane);
  };

  return {
    attach(laneId, soundId) {
      const host = getHost();
      const existing = lanes.get(laneId);
      if (existing?.host === host && existing.soundId === soundId) {
        return;
      }
      release(laneId);
      const lane: LaneOutput = {
        ducked: false,
        host,
        out: null,
        sends: null,
        soundId,
      };
      lanes.set(laneId, lane);
      host.setSoundOutputConnector(soundId, connectorFor(laneId, lane));
    },
    dispose() {
      for (const laneId of [...lanes.keys()]) {
        release(laneId);
      }
    },
    duck(laneId) {
      const lane = lanes.get(laneId);
      if (!lane?.out) {
        return null;
      }
      lane.ducked = true;
      rampGain(lane.out, 0);
      try {
        return wait(LANE_DUCK_MS);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    refresh(laneId) {
      lanes.get(laneId)?.sends?.settle(getSends(laneId));
    },
    release,
    unduck(laneId) {
      const lane = lanes.get(laneId);
      if (lane) {
        lane.ducked = false;
      }
      if (lane?.out) {
        rampGain(lane.out, 1);
      }
    },
  };
}
