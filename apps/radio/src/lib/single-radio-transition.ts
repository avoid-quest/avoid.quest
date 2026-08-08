import { type AudioState, crossfade } from "@/lib/audio";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context.js";
import { singleSelectionAbortReason } from "./single-selection-coordinator.js";

class IncomingPlaybackUnstableError extends Error {
  constructor() {
    super("Incoming stream became unstable during transition");
    this.name = "IncomingPlaybackUnstableError";
  }
}

export function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(singleSelectionAbortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(singleSelectionAbortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

function playbackStateError(state: AudioState): Error | null {
  if (!state.error) {
    return null;
  }
  const error = new Error(state.error.message);
  error.name = state.error.code;
  return error;
}

function isStablePlaybackState(state: {
  error: unknown;
  isBuffering: boolean;
  isLoading: boolean;
  isPlaying: boolean;
}): boolean {
  return (
    state.isPlaying && !state.isLoading && !state.isBuffering && !state.error
  );
}

function normalizePlaybackStateError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return new Error(String(error.message));
  }
  return new Error(String(error));
}

/** Require a continuously healthy window before exposing the incoming sound. */
export function waitForStablePlayback(
  ctx: PlaybackActionContext,
  channelId: string,
  soundId: string,
  signal: AbortSignal,
  stableDurationMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: () => void = () => undefined;

    const clearStableTimer = () => {
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
    };
    const cleanup = () => {
      clearStableTimer();
      signal.removeEventListener("abort", handleAbort);
      unsubscribe();
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const succeed = () => {
      cleanup();
      resolve();
    };
    const inspect = (state: {
      error: unknown;
      isBuffering: boolean;
      isLoading: boolean;
      isPlaying: boolean;
    }) => {
      if (state.error) {
        fail(normalizePlaybackStateError(state.error));
        return;
      }
      if (!isStablePlaybackState(state)) {
        clearStableTimer();
        return;
      }
      if (stableTimer) {
        return;
      }
      if (stableDurationMs <= 0) {
        succeed();
        return;
      }
      stableTimer = setTimeout(succeed, stableDurationMs);
    };
    const handleAbort = () => fail(singleSelectionAbortReason(signal));

    if (signal.aborted) {
      fail(singleSelectionAbortReason(signal));
      return;
    }

    signal.addEventListener("abort", handleAbort, { once: true });
    unsubscribe = ctx.audio.subscribe(soundId, (state) => {
      const error = playbackStateError(state);
      inspect({ ...state, error });
    });

    const runtime = getPlaybackChannelRuntime(channelId);
    if (runtime.soundId !== soundId) {
      fail(new Error("Incoming playback was replaced before it became stable"));
      return;
    }
    inspect(runtime);
  });
}

type StableCrossfadeAttempt = {
  incomingChannelId: string;
  incomingSoundId: string;
  outgoingSoundId: string;
  targetVolume: number;
  duration: number;
  signal: AbortSignal;
};

async function attemptStableCrossfade(
  ctx: PlaybackActionContext,
  attempt: StableCrossfadeAttempt
): Promise<boolean> {
  const {
    duration,
    incomingChannelId,
    incomingSoundId,
    outgoingSoundId,
    signal,
    targetVolume,
  } = attempt;
  const fadeController = new AbortController();
  const handleSelectionAbort = () =>
    fadeController.abort(singleSelectionAbortReason(signal));
  signal.addEventListener("abort", handleSelectionAbort, { once: true });
  const unsubscribe = ctx.audio.subscribe(incomingSoundId, (state) => {
    const error = playbackStateError(state);
    if (error) {
      fadeController.abort(error);
    } else if (!isStablePlaybackState(state)) {
      fadeController.abort(new IncomingPlaybackUnstableError());
    }
  });

  try {
    const runtime = getPlaybackChannelRuntime(incomingChannelId);
    if (runtime.soundId !== incomingSoundId) {
      throw new Error("Incoming playback was replaced during transition");
    }
    if (!isStablePlaybackState(runtime)) {
      fadeController.abort(new IncomingPlaybackUnstableError());
    }

    await crossfade(outgoingSoundId, incomingSoundId, {
      duration,
      targetVolume,
      curve: "equalPower",
      signal: fadeController.signal,
      stopOutgoing: false,
    });

    const finalRuntime = getPlaybackChannelRuntime(incomingChannelId);
    if (
      finalRuntime.soundId === incomingSoundId &&
      isStablePlaybackState(finalRuntime)
    ) {
      return true;
    }
    throw new IncomingPlaybackUnstableError();
  } catch (error) {
    // Cancel active AudioParam curves and keep the known-good stream audible
    // while the incoming transport buffers and retries.
    ctx.audio.setVolume(outgoingSoundId, targetVolume);
    ctx.audio.setVolume(incomingSoundId, 0);

    if (signal.aborted) {
      throw singleSelectionAbortReason(signal);
    }
    const runtime = getPlaybackChannelRuntime(incomingChannelId);
    if (runtime.soundId !== incomingSoundId) {
      throw error;
    }
    if (runtime.error) {
      throw new Error(runtime.error.message);
    }
    if (!(error instanceof IncomingPlaybackUnstableError)) {
      throw error;
    }
    return false;
  } finally {
    signal.removeEventListener("abort", handleSelectionAbort);
    unsubscribe();
  }
}

export async function crossfadeStableIncoming(
  ctx: PlaybackActionContext,
  incomingChannelId: string,
  incomingSoundId: string,
  outgoingSoundId: string,
  targetVolume: number,
  duration: number,
  stableDurationMs: number,
  signal: AbortSignal
): Promise<void> {
  const attempt = {
    duration,
    incomingChannelId,
    incomingSoundId,
    outgoingSoundId,
    signal,
    targetVolume,
  };
  while (true) {
    await waitForStablePlayback(
      ctx,
      incomingChannelId,
      incomingSoundId,
      signal,
      stableDurationMs
    );
    if (await attemptStableCrossfade(ctx, attempt)) {
      return;
    }
  }
}
