/**
 * Sends
 *
 * The cables out of one sender, a lane's `laneOut` or a routing point's
 * output: one GainNode per cable, then its balance when it has one (a
 * Split's branch: a gain per side, openDAW's linear balance), then a
 * DelayNode when the cable has to wait for a slower path to the same
 * place, or goes back into openDAW (a loop through the worklet wants one,
 * at no added delay), then wherever `connect` puts it:
 *
 *   sender → gain(cable) → [balance] → [delay] → connect(to)
 *
 * Every cable starts silent and ramps to its level. A cable that goes, or
 * moves to a new destination, delay or timing, fades out and is let go once
 * silent; until then it still counts as an edge (`edges`), so a new cable
 * can wait for it rather than close a loop with it.
 */

import { safeDisconnect, safeDisconnectFrom } from "../utils.js";

/** Cable level and mute changes: `setTargetAtTime` with τ = 5 ms. */
export const LANE_LEVEL_TIME_CONSTANT_S = 0.005;
/** The layout duck ramps out, and back, over 20 ms. */
export const LANE_DUCK_MS = 20;
/** A dropped send is unwired after 7τ, once its fade is under 0.1%. */
export const LANE_DROP_MS = Math.ceil(LANE_LEVEL_TIME_CONSTANT_S * 7 * 1000);
/** Web Audio renders in blocks of 128 frames. */
export const RENDER_QUANTUM_FRAMES = 128;

/**
 * Pins the param where it is now, mid-ramp included, so a new ramp starts
 * without a jump. Without cancelAndHoldAtTime, the value is read before the
 * cancel drops the ramp it sits on.
 */
function holdParam(param: AudioParam, now: number): void {
  const cancelAndHoldAtTime = param.cancelAndHoldAtTime?.bind(param);
  if (cancelAndHoldAtTime) {
    cancelAndHoldAtTime(now);
    return;
  }
  const held = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(held, now);
}

/** Ramps a level change from wherever the param is now, τ = 5 ms. */
export function settleParam(
  param: AudioParam,
  context: BaseAudioContext,
  value: number
): void {
  const now = context.currentTime;
  holdParam(param, now);
  param.setTargetAtTime(value, now, LANE_LEVEL_TIME_CONSTANT_S);
}

export function settleGain(gain: GainNode, level: number): void {
  settleParam(gain.gain, gain.context, level);
}

/** The layout duck's linear ramp, over `LANE_DUCK_MS`. */
export function rampGain(gain: GainNode, level: number): void {
  const now = gain.context.currentTime;
  holdParam(gain.gain, now);
  gain.gain.linearRampToValueAtTime(level, now + LANE_DUCK_MS / 1000);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One cable as its sender sends it. */
export type SendPlan = {
  /** Where it goes, by destination key. */
  to: string;
  level: number;
  /** Render quanta it waits on its DelayNode. */
  delay: number;
  /** It loops back into openDAW: it passes a DelayNode, delay or not. */
  reenters: boolean;
  /** Its sender hears only live inputs: an output skips the main delay. */
  realtime: boolean;
  /** Each side's gain, for a cable with a balance. */
  balance?: readonly [number, number];
};

/** A cable out of the sender, live or fading out. */
export type SendEdge = {
  to: string;
  /** Resolves once a fading cable is let go; null while it is live. */
  gone: Promise<void> | null;
};

type Send = {
  readonly to: string;
  readonly delay: number;
  readonly reenters: boolean;
  readonly realtime: boolean;
  readonly gain: GainNode;
  /** Each side's gain, and the splitter and merger around them. */
  readonly balance: {
    left: GainNode;
    right: GainNode;
    nodes: AudioNode[];
  } | null;
  readonly tail: DelayNode | null;
  release: () => void;
  /** Let go already: a fade that ends after `drop` finds it gone. */
  unwired: boolean;
};

export type SendConnect = (
  to: string,
  send: AudioNode,
  realtime: boolean
) => () => void;

export class Sends {
  private readonly from: AudioNode;
  private readonly connect: SendConnect;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly live = new Map<string, Send>();
  private readonly fading = new Map<Send, Promise<void>>();

  constructor(
    from: AudioNode,
    connect: SendConnect,
    wait: (ms: number) => Promise<void> = delay
  ) {
    this.from = from;
    this.connect = connect;
    this.wait = wait;
  }

  /** Fades out each cable that went or moved. */
  retire(plans: ReadonlyMap<string, SendPlan>): void {
    for (const [id, send] of this.live) {
      const plan = plans.get(id);
      if (
        plan?.to !== send.to ||
        plan.delay !== send.delay ||
        plan.reenters !== send.reenters ||
        plan.realtime !== send.realtime ||
        (plan.balance === undefined) !== (send.balance === null)
      ) {
        this.fade(id, send);
      }
    }
  }

  /** Ramps each cable to its plan; one that went or moved fades out. */
  settle(plans: ReadonlyMap<string, SendPlan>): void {
    this.retire(plans);
    for (const [id, plan] of plans) {
      const send = this.live.get(id) ?? this.add(id, plan);
      settleGain(send.gain, plan.level);
      if (send.balance && plan.balance) {
        settleGain(send.balance.left, plan.balance[0]);
        settleGain(send.balance.right, plan.balance[1]);
      }
    }
  }

  /** Where its cables go, the ones still fading out included. */
  edges(): SendEdge[] {
    return [
      ...[...this.live.values()].map(({ to }) => ({ gone: null, to })),
      ...[...this.fading].map(([{ to }, gone]) => ({ gone, to })),
    ];
  }

  /** Lets go of every cable now. */
  drop(): void {
    for (const send of [...this.live.values(), ...this.fading.keys()]) {
      this.unwire(send);
    }
    this.live.clear();
    this.fading.clear();
  }

  private add(id: string, plan: SendPlan): Send {
    const { context } = this.from;
    const gain = context.createGain();
    gain.gain.value = 0;
    this.from.connect(gain);
    let end: AudioNode = gain;
    let balance: Send["balance"] = null;
    if (plan.balance) {
      const sides = context.createChannelSplitter(2);
      const merger = context.createChannelMerger(2);
      const left = context.createGain();
      const right = context.createGain();
      [left.gain.value, right.gain.value] = plan.balance;
      gain.connect(sides);
      sides.connect(left, 0);
      sides.connect(right, 1);
      left.connect(merger, 0, 0);
      right.connect(merger, 0, 1);
      balance = { left, nodes: [sides, left, right, merger], right };
      end = merger;
    }
    let tail: DelayNode | null = null;
    if (plan.delay > 0 || plan.reenters) {
      const quantum = RENDER_QUANTUM_FRAMES / context.sampleRate;
      tail = context.createDelay(Math.max(1, plan.delay) * quantum);
      tail.delayTime.value = plan.delay * quantum;
      end.connect(tail);
    }
    const send: Send = {
      balance,
      delay: plan.delay,
      gain,
      realtime: plan.realtime,
      reenters: plan.reenters,
      release: () => undefined,
      tail,
      to: plan.to,
      unwired: false,
    };
    this.live.set(id, send);
    send.release = this.connect(plan.to, tail ?? end, plan.realtime);
    return send;
  }

  private fade(id: string, send: Send): void {
    this.live.delete(id);
    settleGain(send.gain, 0);
    const gone = this.wait(LANE_DROP_MS).then(
      () => this.unwire(send),
      () => this.unwire(send)
    );
    this.fading.set(send, gone);
  }

  private unwire(send: Send): void {
    this.fading.delete(send);
    if (send.unwired) {
      return;
    }
    send.unwired = true;
    send.release();
    safeDisconnectFrom(this.from, send.gain, "Sends.unwire");
    safeDisconnect(send.gain, "Sends.unwire");
    for (const node of send.balance?.nodes ?? []) {
      safeDisconnect(node, "Sends.unwire");
    }
    safeDisconnect(send.tail, "Sends.unwire");
  }
}
