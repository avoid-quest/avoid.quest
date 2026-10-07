/**
 * Node Lane
 *
 * One `LaneSlot` per lane owns that lane over time: what the patch and the
 * listener want (its `plan`, `wantsPlay` and attempt) and at most one
 * `LaneInstance`, one sound with all that hangs off it: its watch, cue tap,
 * file URL, effects and the backend they settled on.
 *
 * One driver per slot moves the instance toward what is wanted, read afresh
 * on each pass: a retiring instance fades out for 150 ms and is released; a
 * lane with a restorable source, or a start owed, gets its sound; changed
 * effects are reconciled with the latest plan, a new FX layout under a duck
 * that lifts once the latest layout is in; a start owed runs on the sound,
 * synchronously up to its play call. A lane's sound id never changes, so a
 * new sound is only made once the last is released. The driver waits only
 * on a fade or on effects, an effects wait ending as its instance retires;
 * a start never waits behind effects, and stays silent under a duck.
 *
 * A start, a track pick, a renewal or a repeat runs as the slot's attempt,
 * which a pause, a newer attempt, a removal or a replaced source aborts. A
 * start still waiting, or a sound playing, when its source is replaced is
 * owed again on the new sound. A Track's or File's sound renews an expired
 * platform URL through DJ's refresh, and at its end repeats when its strip
 * loops or moves to its album's or playlist's next track.
 */

import { captureError } from "@avoid.quest/error";
import type { AudioState, Radio } from "@/lib/audio";
import type { NodeLaneOutputs } from "@/lib/audio/routing/node-lane-outputs";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
import {
  type DeviceInputAudio,
  isDisplayAudioCancel,
  startDeviceInput,
} from "@/lib/device-input-playback";
import { findNextTrack } from "@/lib/dj-actions-playlist";
import { validateRadioForMode } from "@/lib/external-url/utils";
import type { LanePlan } from "@/lib/node-graph/compile";
import { isTrackRadio, retainLocalFileUrl } from "@/lib/node-graph/sources";
import type { CueDeckRegistration } from "@/lib/output-routing.js";
import {
  getRefreshRequest,
  type ResolvePlatformStream,
  radioOnTrack,
  refreshPlatformStream,
} from "@/lib/platform-stream-refresh";
import {
  repeatAtEnd,
  seekSound,
  setPlaybackRate,
  setPreservesPitch,
} from "@/lib/source-strip";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  clearManagedPlaybackErrors,
  getChannelPlayVolume,
  isRestorableRadio,
  playManagedSound,
  setManagedPlaybackError,
} from "../managed-playback-internals.js";
import type { PlaybackActionContext } from "../playback-action-context.js";
import { createPlaybackActionError } from "../playback-action-errors.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
} from "../playback-actions-shared.js";

export type StartResult = "playing" | "failed" | "refused" | "cancelled";

export type EffectsBackend = EffectsRuntimeOutcome["backend"];

/** What a lane needs from the engine that holds it. */
export type LaneHost = {
  readonly ctx: PlaybackActionContext;
  readonly laneOutputs: NodeLaneOutputs;
  readonly resolveStream: ResolvePlatformStream;
  fadeOut: (soundId: string) => Promise<void>;
  /** Reconciles the sound's effects with `plan`'s, keyed from its key lane. */
  reconcileEffects: (
    soundId: string,
    plan: LanePlan
  ) => Promise<EffectsRuntimeOutcome>;
  /** The stream limit a start on `slot` would pass, or null while it fits. */
  streamLimit: (slot: LaneSlot) => number | null;
  /** A lane's sound was made or released. */
  soundChanged: (laneId: string) => void;
  /** A lane's effects backend changed. */
  outcomeChanged: () => void;
  /** Taps a sound pre-fader onto the headphone cue bus. */
  cueTap: (laneId: string, tap: AudioNode | null) => CueDeckRegistration;
  /** Commits `radio` into the lane's source, while it still holds `from`. */
  commitTrack: (laneId: string, from: Radio, radio: Radio) => boolean;
  /** A sound a restore could not make. */
  laneFailed: (slot: LaneSlot, error: unknown) => void;
  /** The slot's driver has nothing left to do. */
  idle: (slot: LaneSlot) => void;
};

/** One run of the lane's transport, aborted by whatever supersedes it. */
type Attempt = {
  readonly kind: "start" | "pick" | "renew" | "repeat";
  readonly controller: AbortController;
  /** A start is owed until it runs; any attempt is done once it ended. */
  state: "owed" | "running" | "done";
  running: Promise<void> | null;
  /** Tells its caller the start's result; a no-op without one. */
  settle: (result: StartResult) => void;
};

const ignore = () => undefined;

/** A step's result, or its signal's abort reason as soon as it aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    promise.catch(ignore);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function reportNodeFailure(message: string) {
  return (error: unknown): void => {
    captureError(error, {
      operation: "nodePlayback",
      surface: "ui",
      tags: { action: message, mode: "node" },
    });
  };
}

/** Pauses whatever sound the channel has and clears its transport state. */
function pauseChannel(ctx: PlaybackActionContext, channelId: string) {
  const { soundId } = getPlaybackChannelRuntime(channelId);
  if (soundId) {
    ctx.audio.pauseSound(soundId);
    setPlaybackChannelRuntime(channelId, () => ({
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
    }));
  }
}

/** The engine's resting filter: a highpass at 0 Hz passes everything. */
const BYPASS_FILTER = {
  enabled: false,
  frequency: 0,
  gain: 0,
  Q: 1,
  type: "highpass",
} as const;

/** Whether a failed start may be a platform URL that expired. */
function canRenew(radio: Radio, error: unknown): boolean {
  return (
    isTrackRadio(radio) &&
    getRefreshRequest(radio) !== null &&
    !(
      error instanceof DOMException &&
      ["AbortError", "NotAllowedError"].includes(error.name)
    )
  );
}

function isAudible(channelId: string): boolean {
  const runtime = getPlaybackChannelRuntime(channelId);
  return runtime.isPlaying || runtime.isLoading;
}

/** One sound for one lane, and everything that hangs off it. */
export class LaneInstance {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly soundId: string;
  /** The backend its effects last settled on, as the controller reported. */
  outcome: EffectsBackend | undefined;
  /**
   * The FX layout last in its tree, by the plan's layout signature, null
   * if unknown: a new sound's is its plan's, as it is silent until it plays.
   */
  private layout: string | null;
  /** Its effects changed since they were last reconciled. */
  private effectsStale = true as boolean;
  private ducked = false as boolean;
  private readonly host: LaneHost;
  private readonly slot: LaneSlot;
  private readonly releaseFile: () => void;
  private cue: CueDeckRegistration | null = null;

  /**
   * Makes the lane's sound, paused, its effects reconciled by this lane.
   * A start validates its source first; a restore only makes a sound for a
   * source it can restore.
   */
  constructor(
    host: LaneHost,
    slot: LaneSlot,
    plan: LanePlan,
    forStart: boolean
  ) {
    this.host = host;
    this.slot = slot;
    this.layout = plan.layoutSignature;
    const radio = plan.radio as Radio;
    if (forStart && plan.source.kind !== "device") {
      validateRadioForMode(radio, "node");
    }
    this.releaseFile = retainLocalFileUrl(radio.streamUrl);
    // A sound the channel kept across a mode switch is the lane's own.
    let { soundId } = getPlaybackChannelRuntime(plan.channelId);
    if (!soundId) {
      try {
        soundId = createManagedSound(
          "node",
          plan.channelId,
          radio,
          { ownsEffects: true },
          host.ctx
        );
      } catch (error) {
        this.releaseFile();
        throw error;
      }
      host.ctx.channels.setMuted("node", plan.channelId, plan.muted);
    }
    this.soundId = soundId;
    // A Track or File sound's state drives its renewal, repeat and advance.
    if (isTrackRadio(radio)) {
      host.ctx.channels.subscribeRuntime("node", plan.channelId, soundId, {
        onAudioState: (state) => this.onAudioState(state),
      });
    }
  }

  private get channelId(): string {
    return this.slot.channelId;
  }

  /** Whether the sound is on its way out: retired, fading or released. */
  get retiring(): boolean {
    return this.signal.aborted;
  }

  /**
   * An expired platform stream is renewed and resumes at its position; an
   * ended track repeats when its strip loops, or else moves to the next.
   * A retiring sound's state acts on nothing: the plan holds its successor.
   */
  private onAudioState(state: AudioState): boolean | undefined {
    if (this.retiring) {
      return;
    }
    if (
      state.error?.code === "STREAM_FETCH_FAILED" &&
      state.error.recoveryPending
    ) {
      return this.slot.renewing();
    }
    if (state.error?.code === "STREAM_INTERRUPTED") {
      return this.slot.renew(state.error.position ?? 0);
    }
    if (state.hasEnded && !state.isPlaying) {
      if (this.slot.plan?.transport?.loop) {
        this.slot.repeat();
      } else {
        this.slot.advance();
      }
    }
  }

  /**
   * Plays the sound at the lane's level until the call settles; one its
   * attempt let go of meanwhile is paused, unless the lane wants it playing.
   */
  private async play(
    signal: AbortSignal,
    play: Promise<unknown> = playManagedSound(
      "node",
      this.soundId,
      this.slot.plan ? getChannelPlayVolume(this.slot.plan) : 1,
      this.host.ctx
    )
  ): Promise<void> {
    try {
      await play;
    } finally {
      if (signal.aborted && !(this.retiring || this.slot.wantsPlay)) {
        pauseChannel(this.host.ctx, this.channelId);
      }
    }
  }

  /**
   * Starts the sound, synchronously up to its play call, inside the budget
   * and with its connector and strip on. A failed platform URL renews once.
   */
  async start(plan: LanePlan, signal: AbortSignal): Promise<StartResult> {
    const limit = this.host.streamLimit(this.slot);
    if (limit !== null) {
      this.slot.fail(
        null,
        `Up to ${limit} streams can play at once here. Pause one to start this.`,
        false
      );
      return "refused";
    }
    clearManagedPlaybackErrors([plan.channelId]);
    // Before the play call: the sound's graph connects inside it.
    this.host.laneOutputs.attach(plan.id, this.soundId);
    // A sound that played before resumes on its nodes at the play call, so
    // its strip goes on first; a new sound's goes on as it connects.
    this.applyStrip();
    const position = plan.transport
      ? (this.host.ctx.audio.getTrackProgress(this.soundId)?.position ?? 0)
      : 0;
    try {
      await (plan.source.kind === "device"
        ? this.startDevice(plan, signal)
        : this.play(signal));
      if (signal.aborted) {
        return "cancelled";
      }
      this.settleStarted();
      return "playing";
    } catch (error) {
      if (signal.aborted) {
        return "cancelled";
      }
      if (canRenew(plan.radio as Radio, error)) {
        return await this.renew(position, signal, true);
      }
      if (!isDisplayAudioCancel(error)) {
        this.slot.fail(error);
      }
      return "failed";
    }
  }

  /**
   * Goes live on an Audio input. A capture still open (muted live) only
   * lifts its gain, as on a DJ deck, unless its device was unplugged
   * meanwhile: that capture opens anew.
   */
  private async startDevice(plan: LanePlan, signal: AbortSignal) {
    if (plan.source.kind !== "device") {
      return;
    }
    const { ctx } = this.host;
    const volume = getChannelPlayVolume(plan);
    applySessionMasterVolume("node", ctx);
    const capture = ctx.audio.getDeviceSource(this.soundId);
    // An unplugged device leaves its capture "active" on an ended track.
    if (capture?.isActive && capture.getDiagnostics()?.readyState !== "ended") {
      await this.play(signal, ctx.audio.playSound(this.soundId, volume));
      return;
    }
    // A dead capture goes, with its tracks and device listener, before the
    // new one replaces it.
    capture?.cleanup();
    ctx.audioEngine.volume.setChannelVolume(this.soundId, volume);
    const audio: DeviceInputAudio = {
      // Only an open capture has channels; a start that didn't open one
      // reads null, so a shared tab's stream is stopped, as on a DJ deck.
      getDeviceChannelCount: (soundId) => {
        const open = ctx.audio.getDeviceSource(soundId);
        return open?.isActive ? open.channelCount : null;
      },
      startDevice: (...args) => ctx.audio.playDeviceSound(...args),
    };
    await abortable(
      this.play(
        signal,
        startDeviceInput(
          audio,
          this.soundId,
          plan.source,
          () => !signal.aborted,
          (isLoading) =>
            setPlaybackChannelRuntime(this.channelId, () => ({ isLoading }))
        )
      ),
      signal
    );
    // A fader or channels changed during the permission prompt keep their
    // latest values.
    const latest = this.slot.plan;
    if (latest && !signal.aborted) {
      this.applyChannels();
      if (!latest.muted) {
        ctx.channels.setVolume("node", this.channelId, latest.volume);
      }
    }
  }

  /**
   * Renews the sound's platform URL at `position`. A start that failed on
   * it plays again; an interrupted stream resumes itself.
   */
  async renew(
    position: number,
    signal: AbortSignal,
    replay = false
  ): Promise<StartResult> {
    const isCurrent = () => !signal.aborted;
    let renewed = false;
    const refresh = refreshPlatformStream(
      this.slot.plan?.radio as Radio,
      this.soundId,
      position,
      {
        isCurrent,
        onFailed: (request, error) =>
          this.slot.fail(error, request.failureMessage),
        onRefreshed: () => {
          renewed = true;
          setPlaybackChannelRuntime(this.channelId, () => ({ error: null }));
        },
        onUnresolved: (request) => this.slot.fail(null, request.failureMessage),
        refresh: async (id, streamUrl, seekPosition, streamFormat) => {
          await this.host.ctx.audioEngine.playback.refreshStreamUrl(
            id,
            streamUrl,
            seekPosition,
            streamFormat
          );
          if (replay && isCurrent()) {
            await this.play(signal);
          }
        },
        resolveStream: this.host.resolveStream,
      }
    );
    await abortable(refresh, signal).catch((error: unknown) => {
      if (!signal.aborted) {
        throw error;
      }
    });
    if (signal.aborted) {
      return "cancelled";
    }
    if (renewed && replay) {
      this.settleStarted();
    }
    return renewed ? "playing" : "failed";
  }

  /** Plays the ended track again from its start: its loop. */
  async repeat(signal: AbortSignal): Promise<StartResult> {
    try {
      const repeated = await repeatAtEnd({
        isCurrent: () => !signal.aborted,
        play: () => this.play(signal),
        seek: () =>
          seekSound(this.host.ctx.audioEngine.playback, this.soundId, 0),
      });
      if (repeated && !signal.aborted) {
        this.settleStarted();
        return "playing";
      }
    } catch (error) {
      if (!signal.aborted) {
        this.slot.fail(error, "Couldn't repeat the track");
      }
    }
    return "cancelled";
  }

  /**
   * Once it plays: its native strip, its transport and cue tap, and the
   * backend its effects graph settled on, which the play call awaited.
   */
  private settleStarted(): void {
    this.applyStrip();
    this.applyTransport();
    this.syncCueTap();
    this.recordOutcome(
      this.host.ctx.audio.getEffectsRuntimeOutcome(this.soundId)
    );
  }

  /**
   * Writes the lane's native strip onto its sound's nodes, once it has
   * them. Both halves are always written, so a pan back to centre or a
   * removed filter reaches a sound that still holds the old values.
   */
  applyStrip(): void {
    const { plan } = this.slot;
    const { audio } = this.host.ctx;
    if (!(plan && audio.getPreFaderNode(this.soundId))) {
      return;
    }
    audio.setPan(this.soundId, plan.pan);
    audio.updateFilter(
      this.soundId,
      plan.filter ? { ...plan.filter, enabled: true, gain: 0 } : BYPASS_FILTER
    );
  }

  /**
   * A Track's or File's speed and key lock, through the strip calls DJ
   * decks share. Written once its sound plays, since a load resets the
   * media element's rate, and on each change.
   */
  applyTransport(): void {
    const transport = this.slot.plan?.transport;
    if (transport) {
      setPlaybackRate(this.host.ctx.audio, this.soundId, transport.speed);
      setPreservesPitch(this.host.ctx.audio, this.soundId, transport.keyLock);
    }
  }

  /** Channels switch live on an open capture; a new one opens with them. */
  applyChannels(): void {
    const source = this.slot.plan?.source;
    const { audio } = this.host.ctx;
    if (source?.kind === "device" && audio.getDeviceSource(this.soundId)) {
      audio.setDeviceChannelSelection(this.soundId, source.channelSelection);
    }
  }

  /**
   * Taps the sound pre-fader onto the headphone cue bus while its cue
   * listen is on, as a DJ deck's CUE does, or takes the tap off. The tap
   * exists once the sound plays.
   */
  syncCueTap(): void {
    const { plan } = this.slot;
    if (!plan?.cueListen) {
      this.cue?.cleanup();
      this.cue = null;
      return;
    }
    const tap = this.host.ctx.audio.getPreFaderNode(this.soundId);
    if (this.cue) {
      this.cue.replaceTap(tap);
      this.cue.setEnabled(true);
      return;
    }
    this.cue = this.host.cueTap(plan.id, tap);
  }

  /** Off ends a tab share, so the tab plays locally again and stops sharing. */
  endTabShare(): void {
    const source = this.slot.plan?.source;
    if (source?.kind === "device" && source.capture === "display") {
      this.host.ctx.audio.getDeviceSource(this.soundId)?.stop();
    }
  }

  /** Its effects or its key lane's sound changed; the driver reconciles. */
  effectsChanged(): void {
    this.effectsStale = true;
  }

  /**
   * The driver's next effects step toward `plan`, or null once they match:
   * changed effects in a new FX layout duck first, unless nothing plays,
   * and the duck lifts once nothing is left. The layout stays unknown
   * until a reconcile succeeds, since a failed, superseded or rejected one
   * may have half-switched the graph: the next change swaps, ducked.
   */
  effectsStep(plan: LanePlan): Promise<void> | null {
    const { laneOutputs } = this.host;
    if (!this.effectsStale) {
      if (this.ducked) {
        this.ducked = false;
        laneOutputs.unduck(plan.id);
      }
      return null;
    }
    const swap = plan.layoutSignature !== this.layout;
    const ducking = swap && !this.ducked && laneOutputs.duck(plan.id);
    if (ducking) {
      this.ducked = true;
      return ducking;
    }
    this.effectsStale = false;
    this.layout = null;
    return this.host.reconcileEffects(this.soundId, plan).then((outcome) => {
      if (!["failed", "superseded"].includes(outcome.status)) {
        this.layout = plan.layoutSignature;
      }
      this.recordOutcome(outcome);
    }, reportNodeFailure("Could not apply lane effects"));
  }

  /**
   * Keeps what the controller reported. An inactive outcome means no
   * effects graph yet, so the estimate shows. A ready `bypass` only means
   * nothing was on to process (every FX off), not a dry fallback, so it is
   * not kept: switching an FX back on must not read `bypassed` while the
   * new runtime connects.
   */
  private recordOutcome(outcome: EffectsRuntimeOutcome): void {
    if (this.retiring || outcome.status === "superseded") {
      return;
    }
    this.outcome =
      outcome.status === "inactive" ||
      (outcome.backend === "bypass" && outcome.status !== "failed")
        ? undefined
        : outcome.backend;
    this.host.outcomeChanged();
  }

  /**
   * Lets go of the sound at once: nothing it started lands, its state acts
   * on nothing, and its sends keep their levels through its fade-out.
   */
  retire(): void {
    this.controller.abort();
  }

  /** Fades the retired sound out, then releases its channel and outputs. */
  async release(): Promise<void> {
    try {
      await this.host.fadeOut(this.soundId);
    } catch (error) {
      console.warn("[NodePlayback] Could not fade out a removed lane", error);
    }
    this.cue?.cleanup();
    this.cue = null;
    try {
      cleanupManagedChannel(this.channelId, this.host.ctx);
    } catch (error) {
      console.warn("[NodePlayback] Could not release a removed lane", error);
    }
    resetPlaybackChannelRuntime(this.channelId);
    this.releaseFile();
    this.host.laneOutputs.release(this.slot.laneId);
  }
}

/** One lane's wanted state, its sound, and the driver between them. */
export class LaneSlot {
  readonly laneId: string;
  readonly channelId: string;
  /** What the patch wants; null once the lane is removed. */
  plan: LanePlan | null;
  /** The listener's transport: a play landing late re-pauses without it. */
  wantsPlay = false as boolean;
  current: LaneInstance | null = null;
  private readonly host: LaneHost;
  private attempt: Attempt | null = null;
  /** A restore wants the lane's sound made, paused, without a start. */
  private wantsSound = false as boolean;
  /** The step the driver waits on, until it ends. */
  private waiting: Promise<void> | null = null;

  constructor(host: LaneHost, plan: LanePlan) {
    this.host = host;
    this.laneId = plan.id;
    this.channelId = plan.channelId;
    this.plan = plan;
    this.restore(plan);
  }

  /**
   * A restorable source gets its sound made, paused. Any other, a local
   * file from an earlier page or an Audio input, gets none until it plays,
   * so a stale runtime left for its channel is cleared.
   */
  private restore(plan: LanePlan): void {
    this.wantsSound =
      plan.source.kind !== "device" &&
      isRestorableRadio(plan.radio as Radio, "node");
    if (!(this.wantsSound || this.current)) {
      resetPlaybackChannelRuntime(this.channelId);
    }
  }

  /** Takes a new plan for the lane; a replaced source retires the sound. */
  update(plan: LanePlan, replaced: boolean): void {
    if (replaced) {
      this.replace();
    }
    if (replaced || !this.plan) {
      this.restore(plan);
    }
    this.plan = plan;
    this.kick();
  }

  /**
   * The sound goes at once. A start waiting, or a sound playing, is owed on
   * the new one; anything running was for the source that went.
   */
  private replace(): void {
    const { attempt, current } = this;
    const owed = attempt?.state === "owed";
    if (owed || (current && !current.retiring && isAudible(this.channelId))) {
      const settle = owed ? attempt.settle : ignore;
      if (owed) {
        attempt.settle = ignore;
      }
      this.wantsPlay = true;
      this.begin("start", settle);
    } else {
      this.abort();
    }
    current?.retire();
  }

  /** The lane goes: its attempt drops and its sound fades out. */
  remove(): void {
    this.plan = null;
    this.wantsSound = false;
    this.abort();
    this.current?.retire();
    this.kick();
  }

  play(): Promise<StartResult> {
    if (!this.plan) {
      return Promise.resolve("cancelled");
    }
    this.wantsPlay = true;
    return new Promise((settle) => {
      this.begin("start", settle);
      this.kick();
    });
  }

  pause(endTabShare = false): void {
    this.wantsPlay = false;
    this.abort();
    if (endTabShare) {
      this.current?.endTabShare();
    }
    pauseChannel(this.host.ctx, this.channelId);
  }

  /**
   * Moves the lane to the track `pick` resolves, as one commit, and plays
   * it once the old sound is released.
   */
  async playTrack(
    pick: (signal: AbortSignal) => Promise<Radio | null>,
    failure: string
  ): Promise<StartResult> {
    const from = this.plan?.radio as Radio | undefined;
    if (!from) {
      return "cancelled";
    }
    const attempt = this.begin("pick");
    const { signal } = attempt.controller;
    const picking = abortable(pick(signal), signal);
    // The pick is lane work until it ends, as a start's run is.
    attempt.running = picking.then(ignore, ignore);
    let picked: Radio | null = null;
    let cause: unknown = null;
    try {
      picked = await picking;
    } catch (error) {
      cause = error;
    } finally {
      attempt.state = "done";
    }
    // A pause can land between the pick resolving and this resuming.
    if (signal.aborted) {
      return "cancelled";
    }
    if (!picked) {
      this.fail(cause, failure);
      return "failed";
    }
    // Owed before the commit replaces the source, so it carries over.
    return new Promise((settle) => {
      this.begin("start", settle);
      if (this.host.commitTrack(this.laneId, from, picked)) {
        this.wantsPlay = true;
        this.kick();
      } else {
        this.abort();
      }
    });
  }

  /** At the end of a track, the next one in its album or playlist. */
  advance(): void {
    const radio = this.plan?.radio as Radio | undefined;
    const next = radio && findNextTrack(radio);
    if (radio && next && this.free()) {
      this.playTrack(
        () => radioOnTrack(radio, next.streamUrl, this.host.resolveStream),
        "Couldn't load the next track"
      ).catch((error: unknown) =>
        console.warn("[NodePlayback] Could not play the next track", error)
      );
    }
  }

  repeat(): void {
    const { current } = this;
    if (current && this.free()) {
      this.run(this.begin("repeat"), (signal) => current.repeat(signal));
    }
  }

  /**
   * Renews an interrupted platform stream, one renewal at a time. Returns
   * whether the lane owns the interruption's report.
   */
  renew(position: number): boolean {
    const radio = this.plan?.radio as Radio | undefined;
    const { current } = this;
    if (!(radio && current) || getRefreshRequest(radio) === null) {
      return false;
    }
    if (!this.renewing()) {
      this.run(this.begin("renew"), (signal) =>
        current.renew(position, signal)
      );
    }
    return true;
  }

  renewing(): boolean {
    return this.attempt?.kind === "renew" && this.attempt.state === "running";
  }

  /** Any attempt in progress owns the lane's next move. */
  private free(): boolean {
    return !this.attempt || this.attempt.state === "done";
  }

  /**
   * Whether the lane takes a stream slot: starting, renewing or playing a
   * stream. A live input is no stream.
   */
  busyStream(): boolean {
    if (this.plan?.source.kind === "device") {
      return false;
    }
    const { attempt } = this;
    const stepping = attempt?.state === "running" && attempt.kind !== "pick";
    return stepping || isAudible(this.channelId);
  }

  /** Shows and reports a failure, worded by `userMessage` or its cause. */
  fail(cause: unknown, userMessage?: string, report = true): void {
    const radio = this.plan?.radio as Radio | undefined;
    const error = createPlaybackActionError({
      cause,
      channelId: this.channelId,
      mode: "node",
      radio,
    });
    if (userMessage) {
      error.userMessage = userMessage;
    }
    if (report) {
      this.host.ctx.reportError(error);
    }
    setManagedPlaybackError(this.channelId, error, radio);
  }

  /** Whether the driver or an attempt still has work. */
  busy(): boolean {
    return this.waiting !== null || this.attempt?.state === "running";
  }

  /** Resolves once the driver's step and the attempt in progress end. */
  async whenIdle(): Promise<void> {
    await Promise.all([this.waiting, this.attempt?.running]);
  }

  private begin(
    kind: Attempt["kind"],
    settle: Attempt["settle"] = ignore
  ): Attempt {
    this.abort();
    this.attempt = {
      controller: new AbortController(),
      kind,
      running: null,
      settle,
      state: kind === "start" ? "owed" : "running",
    };
    return this.attempt;
  }

  /** Drops the attempt; a running one's caller hears once its step ends. */
  private abort(): void {
    const { attempt } = this;
    if (attempt) {
      attempt.controller.abort();
      if (attempt.state !== "running") {
        this.end(attempt, "cancelled");
      }
      this.attempt = null;
    }
  }

  private end(attempt: Attempt, result: StartResult): void {
    // An aborted attempt's failure is no longer the listener's transport.
    if (
      (result === "failed" || result === "refused") &&
      !attempt.controller.signal.aborted
    ) {
      this.wantsPlay = false;
    }
    attempt.state = "done";
    attempt.settle(result);
  }

  /** Runs `step` as `attempt`, which ends with it. */
  private run(
    attempt: Attempt,
    step: (signal: AbortSignal) => Promise<StartResult>
  ): void {
    attempt.state = "running";
    attempt.running = step(attempt.controller.signal)
      .catch((error: unknown) => {
        console.warn("[NodePlayback] A lane start failed", error);
        return "failed" as const;
      })
      .then((result) => this.end(attempt, result));
  }

  /** Runs the start owed, synchronously up to its play call. */
  private startOwed(): void {
    const { attempt, current, plan } = this;
    if (attempt?.state === "owed" && plan && current && !current.retiring) {
      this.run(attempt, (signal) => current.start(plan, signal));
    }
  }

  /** Something wanted changed: a start owed runs now, beside any step. */
  kick(): void {
    if (this.waiting) {
      this.startOwed();
    } else {
      this.drive();
    }
  }

  /** The lane's effects or its key lane's sound changed. */
  effectsChanged(): void {
    this.current?.effectsChanged();
    this.kick();
  }

  /** Takes each step toward what is wanted until one waits, then goes on. */
  private drive(): void {
    for (;;) {
      const { current, plan } = this;
      let step: Promise<void> | null = null;
      if (current?.retiring) {
        step = this.release(current);
      } else if (!plan) {
        break;
      } else if (current) {
        const effects = current.effectsStep(plan);
        this.startOwed();
        if (!effects) {
          break;
        }
        step = abortable(effects, current.signal);
      } else {
        if (!(this.wantsSound || this.attempt?.state === "owed")) {
          break;
        }
        this.create(plan);
        continue;
      }
      const next = () => {
        this.waiting = null;
        this.drive();
      };
      this.waiting = step.then(next, next);
      return;
    }
    this.host.idle(this);
  }

  private async release(instance: LaneInstance): Promise<void> {
    await instance.release();
    this.current = null;
    this.host.soundChanged(this.laneId);
  }

  private create(plan: LanePlan): void {
    const { attempt } = this;
    const forStart = attempt?.state === "owed";
    this.wantsSound = false;
    try {
      this.current = new LaneInstance(this.host, this, plan, forStart);
    } catch (error) {
      if (forStart) {
        this.fail(error);
        this.end(attempt, "failed");
      } else {
        this.host.laneFailed(this, error);
      }
      return;
    }
    this.host.soundChanged(this.laneId);
  }
}
