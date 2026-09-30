/**
 * Node Lane Outputs
 *
 * One stable `laneOut` GainNode per node lane, between the lane sound's
 * fader and the outputs its cables reach, fanned out into one send per
 * output (sink):
 *
 *   nodes.gain (fader) → laneOut → send(Speakers) → OutputRouting.connectMain
 *                                → send(Output device) → its device sink
 *
 * The fader belongs to the volume controller and master volume, so node code
 * never writes it. Each send's gain is the sum of the lane's unmuted cables
 * into its sink; laneOut carries only the layout duck. Where a send goes is
 * the `route` callback's call: Speakers go to the main bus, an Output device
 * to its sink, or back to the main bus when that sink can't play.
 *
 * laneOut is built inside the lane's output connector, which AudioManager
 * calls synchronously while it connects the sound's native shell, so it
 * exists before any await of the play gesture. Every send starts silent
 * and ramps to its level.
 */

import type { AudioManager } from "../manager/audio-manager.js";
import type {
  MainOutputConnect,
  SoundOutputConnector,
} from "../manager/audio-manager-types.js";
import { safeDisconnect, safeDisconnectFrom } from "../utils.js";

export type LaneOutputHost = Pick<AudioManager, "setSoundOutputConnector">;

/**
 * Connects one send to where its sink plays and returns its disconnect.
 * `connectMain` puts the send on the main bus, as Speakers do.
 */
export type LaneSinkRoute = (
  sinkId: string,
  send: GainNode,
  connectMain: () => () => void
) => () => void;

export type NodeLaneOutputsOptions = {
  /** Read at attach time: the default context's AudioManager can be reset. */
  getHost: () => LaneOutputHost;
  /** The lane's level per sink now: the sum of its unmuted cables into it. */
  getLevels: (laneId: string) => ReadonlyMap<string, number>;
  /** Where a sink's sends go; every sink is the main bus without it. */
  route?: LaneSinkRoute;
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
   * The layout duck: ramps laneOut to 0, runs `replace` once silent, awaits
   * its outcome, then ramps back. Without a laneOut it just replaces.
   */
  swap: <T>(laneId: string, replace: () => Promise<T>) => Promise<T>;
  /**
   * Reconnects every send into `sinkId` (every send without it) through
   * `route`, e.g. when a device sink fails over to Speakers.
   */
  reroute: (sinkId?: string) => void;
  /** Takes every lane's send into a removed sink off it. */
  dropSink: (sinkId: string) => void;
  /** Unregisters the connector and drops laneOut. Its sound is gone. */
  release: (laneId: string) => void;
  dispose: () => void;
};

/** Cable level and mute changes: `setTargetAtTime` with τ = 5 ms. */
export const LANE_LEVEL_TIME_CONSTANT_S = 0.005;
/** The layout duck ramps out, and back, over 20 ms. */
export const LANE_DUCK_MS = 20;

type LaneSend = { gain: GainNode; release: () => void };

type LaneOutput = {
  soundId: string;
  host: LaneOutputHost;
  out: GainNode | null;
  /** From the last connect: the main bus, and whether it is realtime. */
  connectMain: MainOutputConnect | null;
  realtime: boolean;
  sends: Map<string, LaneSend>;
  /** Swaps in flight; laneOut stays at 0 until the last one ends. */
  ducks: number;
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

function settleSend(send: GainNode, level: number): void {
  const now = send.context.currentTime;
  hold(send.gain, now);
  send.gain.setTargetAtTime(level, now, LANE_LEVEL_TIME_CONSTANT_S);
}

const toMain: LaneSinkRoute = (_sinkId, _send, connectMain) => connectMain();

export function createNodeLaneOutputs({
  getHost,
  getLevels,
  route = toMain,
  wait = delay,
}: NodeLaneOutputsOptions): NodeLaneOutputs {
  const lanes = new Map<string, LaneOutput>();

  const connectSend = (
    lane: LaneOutput,
    sinkId: string,
    gain: GainNode
  ): (() => void) =>
    route(sinkId, gain, () => {
      // connectMain is idempotent per node and heals a rebuilt output graph.
      const release = lane.connectMain?.(gain, lane.realtime);
      return release ?? (() => undefined);
    });

  const dropSend = (lane: LaneOutput, send: LaneSend) => {
    send.release();
    safeDisconnectFrom(lane.out, send.gain, "NodeLaneOutputs.dropSend");
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
        send = { gain, release: connectSend(lane, sinkId, gain) };
        lane.sends.set(sinkId, send);
      }
      settleSend(send.gain, level);
    }
    // A sink the lane no longer reaches fades out, ready for a new cable.
    for (const [sinkId, send] of lane.sends) {
      if (!levels.has(sinkId)) {
        settleSend(send.gain, 0);
      }
    }
  };

  const dropOut = (lane: LaneOutput) => {
    for (const send of lane.sends.values()) {
      dropSend(lane, send);
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
    out.gain.value = lane.ducks > 0 ? 0 : 1;
    lane.out = out;
    return out;
  };

  const connectorFor =
    (laneId: string, lane: LaneOutput): SoundOutputConnector =>
    (source, realtime, connectMain) => {
      const out = ensureOut(lane, source.context);
      source.connect(out);
      const reconnect =
        lane.connectMain !== connectMain || lane.realtime !== realtime;
      lane.connectMain = connectMain;
      lane.realtime = realtime;
      if (reconnect) {
        rerouteLane(lane);
      }
      settle(laneId, lane);
      return () => {
        safeDisconnectFrom(source, out, "NodeLaneOutputs.disconnect");
      };
    };

  const rerouteLane = (lane: LaneOutput, sinkId?: string) => {
    for (const [id, send] of lane.sends) {
      if (sinkId === undefined || id === sinkId) {
        send.release();
        send.release = connectSend(lane, id, send.gain);
      }
    }
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
        connectMain: null,
        ducks: 0,
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
        if (send) {
          dropSend(lane, send);
          lane.sends.delete(sinkId);
        }
      }
    },
    refresh(laneId) {
      const lane = lanes.get(laneId);
      if (lane) {
        settle(laneId, lane);
      }
    },
    release,
    reroute(sinkId) {
      for (const lane of lanes.values()) {
        rerouteLane(lane, sinkId);
      }
    },
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
          rampLinear(lane.out, 1);
        }
      }
    },
  };
}
