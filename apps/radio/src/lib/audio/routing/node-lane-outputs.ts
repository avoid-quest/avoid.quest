/**
 * Node Lane Outputs
 *
 * One stable `laneOut` GainNode per node lane, between the lane sound's
 * fader and the outputs its cables reach, fanned out into one send per
 * output (sink):
 *
 *   nodes.gain (fader) → laneOut → send(sink) → the sink's Output node gain
 *
 * The fader belongs to the volume controller and master volume, so node code
 * never writes it. Each send's gain is the sum of the lane's unmuted cables
 * into its sink; laneOut carries only the layout duck. Where a send goes is
 * the `route` callback's call: the Output node's own gain
 * (node-device-sinks), which carries its mute.
 *
 * laneOut is built inside the lane's output connector, which AudioManager
 * calls synchronously while it connects the sound's native shell, so it
 * exists before any await of the play gesture. Every send starts silent
 * and ramps to its level.
 */

import type { AudioManager } from "../manager/audio-manager.js";
import type { SoundOutputConnector } from "../manager/audio-manager-types.js";
import { safeDisconnect, safeDisconnectFrom } from "../utils.js";

export type LaneOutputHost = Pick<AudioManager, "setSoundOutputConnector">;

/**
 * Connects one send to its sink and returns its disconnect. A realtime
 * lane (a live input) skips the main delay.
 */
export type LaneSinkRoute = (
  sinkId: string,
  send: GainNode,
  realtime: boolean
) => () => void;

export type NodeLaneOutputsOptions = {
  /** Read at attach time: the default context's AudioManager can be reset. */
  getHost: () => LaneOutputHost;
  /** The lane's level per sink now: the sum of its unmuted cables into it. */
  getLevels: (laneId: string) => ReadonlyMap<string, number>;
  /** Where a sink's sends go. */
  route: LaneSinkRoute;
  /**
   * Runs as the lane's sound connects: its native nodes exist from here,
   * and its playback has not started yet.
   */
  onConnect?: (laneId: string) => void;
  wait?: (ms: number) => Promise<void>;
};

export type NodeLaneOutputs = {
  /**
   * Registers the lane's connector for `soundId`. Call it before the sound
   * plays; it is a no-op while the same sound is attached.
   */
  attach: (laneId: string, soundId: string) => void;
  /** Ramps each of the lane's sends to its current level. */
  refresh: (laneId: string) => void;
  /**
   * The layout duck: ramps laneOut to 0 and resolves once it is silent;
   * null without a laneOut. The lane swaps its tree, then unducks.
   */
  duck: (laneId: string) => Promise<void> | null;
  /** Ramps laneOut back from the layout duck. */
  unduck: (laneId: string) => void;
  /** Fades every lane's send into a removed sink out, then takes it off. */
  dropSink: (sinkId: string) => void;
  /** Unregisters the connector and drops laneOut. Its sound is gone. */
  release: (laneId: string) => void;
  dispose: () => void;
};

/** Cable level and mute changes: `setTargetAtTime` with τ = 5 ms. */
export const LANE_LEVEL_TIME_CONSTANT_S = 0.005;
/** The layout duck ramps out, and back, over 20 ms. */
export const LANE_DUCK_MS = 20;
/** A dropped send is unwired after 7τ, once its fade is under 0.1%. */
export const LANE_DROP_MS = Math.ceil(LANE_LEVEL_TIME_CONSTANT_S * 7 * 1000);

type LaneSend = { gain: GainNode; release: () => void };

type LaneOutput = {
  soundId: string;
  host: LaneOutputHost;
  out: GainNode | null;
  /** From the last connect: whether it skips the main delay. */
  realtime: boolean;
  sends: Map<string, LaneSend>;
  /** Under a layout duck: a rebuilt laneOut starts silent too. */
  ducked: boolean;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pins the param where it is now, mid-ramp included, so a new ramp starts
 * without a jump. Without cancelAndHoldAtTime, the value is read before the
 * cancel drops the ramp it sits on.
 */
function hold(param: AudioParam, now: number): void {
  const cancelAndHoldAtTime = param.cancelAndHoldAtTime?.bind(param);
  if (cancelAndHoldAtTime) {
    cancelAndHoldAtTime(now);
    return;
  }
  const held = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(held, now);
}

function rampLinear(out: GainNode, level: number): void {
  const now = out.context.currentTime;
  hold(out.gain, now);
  out.gain.linearRampToValueAtTime(level, now + LANE_DUCK_MS / 1000);
}

/** Ramps a level change from wherever the gain is now, τ = 5 ms. */
export function settleGain(gain: GainNode, level: number): void {
  const now = gain.context.currentTime;
  hold(gain.gain, now);
  gain.gain.setTargetAtTime(level, now, LANE_LEVEL_TIME_CONSTANT_S);
}

export function createNodeLaneOutputs({
  getHost,
  getLevels,
  onConnect,
  route,
  wait = delay,
}: NodeLaneOutputsOptions): NodeLaneOutputs {
  const lanes = new Map<string, LaneOutput>();

  const dropSend = (out: GainNode | null, send: LaneSend) => {
    send.release();
    safeDisconnectFrom(out, send.gain, "NodeLaneOutputs.dropSend");
    safeDisconnect(send.gain, "NodeLaneOutputs.dropSend");
  };

  const settle = (laneId: string, lane: LaneOutput) => {
    const { out } = lane;
    if (!out) {
      return;
    }
    const levels = getLevels(laneId);
    for (const [sinkId, level] of levels) {
      let send = lane.sends.get(sinkId);
      if (!send) {
        const gain = out.context.createGain();
        gain.gain.value = 0;
        out.connect(gain);
        send = { gain, release: route(sinkId, gain, lane.realtime) };
        lane.sends.set(sinkId, send);
      }
      settleGain(send.gain, level);
    }
    // A sink the lane no longer reaches fades out, ready for a new cable.
    for (const [sinkId, send] of lane.sends) {
      if (!levels.has(sinkId)) {
        settleGain(send.gain, 0);
      }
    }
  };

  const dropOut = (lane: LaneOutput) => {
    for (const send of lane.sends.values()) {
      dropSend(lane.out, send);
    }
    lane.sends.clear();
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
    return out;
  };

  const connectorFor =
    (laneId: string, lane: LaneOutput): SoundOutputConnector =>
    (source, realtime) => {
      onConnect?.(laneId);
      const out = ensureOut(lane, source.context);
      source.connect(out);
      lane.realtime = realtime;
      settle(laneId, lane);
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
        realtime: false,
        sends: new Map(),
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
    dropSink(sinkId) {
      for (const lane of lanes.values()) {
        const send = lane.sends.get(sinkId);
        if (!send) {
          continue;
        }
        // Off the lane now, so a new cable gets a new send; it fades out
        // first, through the Output node's gain, which waits for it.
        lane.sends.delete(sinkId);
        const { out } = lane;
        settleGain(send.gain, 0);
        wait(LANE_DROP_MS).then(
          () => dropSend(out, send),
          () => dropSend(out, send)
        );
      }
    },
    duck(laneId) {
      const lane = lanes.get(laneId);
      if (!lane?.out) {
        return null;
      }
      lane.ducked = true;
      rampLinear(lane.out, 0);
      try {
        return wait(LANE_DUCK_MS);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    refresh(laneId) {
      const lane = lanes.get(laneId);
      if (lane) {
        settle(laneId, lane);
      }
    },
    release,
    unduck(laneId) {
      const lane = lanes.get(laneId);
      if (lane) {
        lane.ducked = false;
      }
      if (lane?.out) {
        rampLinear(lane.out, 1);
      }
    },
  };
}
