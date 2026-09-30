/**
 * Node Lane Outputs
 *
 * One stable `laneOut` GainNode per node lane, between the lane sound's
 * fader and the main bus:
 *
 *   nodes.gain (fader) → laneOut → OutputRouting.connectMain
 *
 * The fader belongs to the volume controller and master volume, so node code
 * never writes it. Cable levels, cable mutes and the layout duck all act on
 * laneOut instead.
 *
 * laneOut is built inside the lane's output connector, which AudioManager
 * calls synchronously while it connects the sound's native shell, so it
 * exists before any await of the play gesture. It starts silent and ramps
 * to the lane's cable level.
 */

import type { AudioManager } from "../manager/audio-manager.js";
import type { SoundOutputConnector } from "../manager/audio-manager-types.js";
import { safeDisconnect, safeDisconnectFrom } from "../utils.js";

export type LaneOutputHost = Pick<AudioManager, "setSoundOutputConnector">;

export type NodeLaneOutputsOptions = {
  /** Read at attach time: the default context's AudioManager can be reset. */
  getHost: () => LaneOutputHost;
  /** The lane's cable level now: the sum of its unmuted cable gains. */
  getLevel: (laneId: string) => number;
  wait?: (ms: number) => Promise<void>;
};

export type NodeLaneOutputs = {
  /**
   * Registers the lane's connector for `soundId`. Call it before the sound
   * plays; it is a no-op while the same sound is attached.
   */
  attach: (laneId: string, soundId: string) => void;
  /** Ramps laneOut to the lane's current level, unless a swap holds it. */
  refresh: (laneId: string) => void;
  /**
   * The layout duck: ramps laneOut to 0, runs `replace` once silent, awaits
   * its outcome, then ramps back. Without a laneOut it just replaces.
   */
  swap: <T>(laneId: string, replace: () => Promise<T>) => Promise<T>;
  /** Unregisters the connector and drops laneOut. Its sound is gone. */
  release: (laneId: string) => void;
  dispose: () => void;
};

/** Cable level and mute changes: `setTargetAtTime` with τ = 5 ms. */
export const LANE_LEVEL_TIME_CONSTANT_S = 0.005;
/** The layout duck ramps out, and back, over 20 ms. */
export const LANE_DUCK_MS = 20;

type LaneOutput = {
  soundId: string;
  host: LaneOutputHost;
  out: GainNode | null;
  releaseMain: (() => void) | null;
  /** Swaps in flight; laneOut stays at 0 until the last one ends. */
  ducks: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pins the param where it is now, so a new ramp starts without a jump. */
function hold(param: AudioParam, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
}

function rampLinear(out: GainNode, level: number): void {
  const now = out.context.currentTime;
  hold(out.gain, now);
  out.gain.linearRampToValueAtTime(level, now + LANE_DUCK_MS / 1000);
}

export function createNodeLaneOutputs({
  getHost,
  getLevel,
  wait = delay,
}: NodeLaneOutputsOptions): NodeLaneOutputs {
  const lanes = new Map<string, LaneOutput>();

  const settle = (laneId: string, lane: LaneOutput) => {
    if (!lane.out || lane.ducks > 0) {
      return;
    }
    const now = lane.out.context.currentTime;
    hold(lane.out.gain, now);
    lane.out.gain.setTargetAtTime(
      getLevel(laneId),
      now,
      LANE_LEVEL_TIME_CONSTANT_S
    );
  };

  const dropOut = (lane: LaneOutput) => {
    lane.releaseMain?.();
    lane.releaseMain = null;
    safeDisconnect(lane.out, "NodeLaneOutputs.release");
    lane.out = null;
  };

  const ensureOut = (
    laneId: string,
    lane: LaneOutput,
    context: BaseAudioContext
  ) => {
    if (lane.out?.context === context) {
      return lane.out;
    }
    dropOut(lane);
    const out = context.createGain();
    out.gain.value = 0;
    lane.out = out;
    settle(laneId, lane);
    return out;
  };

  const connectorFor =
    (laneId: string, lane: LaneOutput): SoundOutputConnector =>
    (source, realtime, connectMain) => {
      const out = ensureOut(laneId, lane, source.context);
      source.connect(out);
      // connectMain is idempotent per node and heals a rebuilt output graph.
      lane.releaseMain = connectMain(out, realtime);
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
        ducks: 0,
        host,
        out: null,
        releaseMain: null,
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
    refresh(laneId) {
      const lane = lanes.get(laneId);
      if (lane) {
        settle(laneId, lane);
      }
    },
    release,
    async swap(laneId, replace) {
      const lane = lanes.get(laneId);
      if (!lane?.out) {
        return await replace();
      }
      lane.ducks += 1;
      rampLinear(lane.out, 0);
      try {
        await wait(LANE_DUCK_MS);
        return await replace();
      } finally {
        lane.ducks -= 1;
        if (lane.ducks === 0 && lane.out && lanes.get(laneId) === lane) {
          rampLinear(lane.out, getLevel(laneId));
        }
      }
    },
  };
}
