import { MediaRecoveryController } from "./media-recovery-controller.js";
import type { PlaybackInput } from "./playback-source.js";
import type { StreamStatus } from "./types.js";

const NO_PROGRESS_WATCHDOG_MS = 6000;
const MAX_FETCH_WITHOUT_MEDIA_PROGRESS_MS = NO_PROGRESS_WATCHDOG_MS * 2;
const MIN_MEDIA_TIME_PROGRESS_SECONDS = 0.1;

type RecoverySnapshot = {
  currentTime: number;
  duration: number;
  generation: number;
  input: PlaybackInput | null;
  isBuffering: boolean;
  isOffline: boolean;
  paused: boolean;
  readyState: number;
  shouldResume: boolean;
  status: StreamStatus;
};

type RecoveryActions = {
  abortReload: () => void;
  getSnapshot: () => RecoverySnapshot;
  onStreamError: (position: number, error: Error) => void;
  onTerminalError: (error: Error, recoveryPending?: boolean) => void;
  reload: (input: PlaybackInput, generation: number) => Promise<void>;
  resume: () => Promise<void>;
  setState: (status: StreamStatus, isBuffering: boolean) => void;
};

/** Owns media recovery transitions from the first stall through reload. */
export class MediaPlaybackRecovery {
  private readonly actions: RecoveryActions;
  private readonly timer = new MediaRecoveryController();
  private progressEpoch = 0;
  private _isReloading: boolean;

  constructor(actions: RecoveryActions) {
    this.actions = actions;
    this._isReloading = false;
  }

  get isReloading(): boolean {
    return this._isReloading;
  }

  canPlay(): void {
    this.progressEpoch += 1;
    const state = this.actions.getSnapshot();
    if (state.shouldResume && state.status === "buffering" && state.paused) {
      this.actions.resume().catch(() => {
        // Keep recovery armed; browser policy may require another gesture.
      });
    }
  }

  cancel(): void {
    if (this._isReloading) {
      this.actions.abortReload();
    }
    this.timer.cancel();
    this._isReloading = false;
  }

  failed(error: Error): void {
    const state = this.actions.getSnapshot();
    if (!(state.shouldResume && state.input)) {
      this.terminal(error);
      return;
    }

    // Finite platform media can have expiring URLs. The caller re-resolves
    // those URLs; live streams are reloaded in place.
    if (Number.isFinite(state.duration)) {
      this.actions.onStreamError(state.currentTime, error);
      this.terminal(error, true);
      return;
    }

    this.watch(error);
  }

  networkProgress(): void {
    this.progressEpoch += 1;
  }

  offline(): void {
    const state = this.actions.getSnapshot();
    if (!(state.shouldResume && state.input)) {
      return;
    }

    if (!this.timer.error) {
      this.timer.noteStall(new Error("Network connection is offline"));
    }
    this.timer.suspend();
    if (state.paused || state.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      this.actions.setState("buffering", true);
    }
  }

  online(): void {
    const state = this.actions.getSnapshot();
    if (!(state.shouldResume && state.input)) {
      return;
    }

    // A network handoff does not prove playback stopped. The watchdog reloads
    // only if the media clock stays frozen for a complete window.
    this.watch(
      this.timer.error ?? new Error("Network connection restored"),
      state.isBuffering
    );
  }

  playing(): boolean {
    const state = this.actions.getSnapshot();
    if (!(state.shouldResume && state.input)) {
      return false;
    }
    this.timer.markRecovered();
    this.actions.setState("streaming", false);
    return true;
  }

  stalled(): void {
    const state = this.actions.getSnapshot();
    if (state.status === "idle" || state.status === "ended") {
      return;
    }

    if (state.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      this.actions.setState("buffering", true);
      this.watch(new Error("Audio stream stopped making network progress"));
    }
  }

  waiting(): void {
    const state = this.actions.getSnapshot();
    if (state.status === "idle" || state.status === "ended") {
      return;
    }
    this.actions.setState("buffering", true);
    this.watch(new Error("Audio playback is waiting for buffered media"));
  }

  watch(error: Error, markBuffering = true): void {
    const state = this.actions.getSnapshot();
    if (!(state.shouldResume && state.input)) {
      return;
    }

    this.timer.noteStall(error);
    if (markBuffering) {
      this.actions.setState("buffering", true);
    }
    if (state.isOffline || this.timer.hasTimer) {
      return;
    }

    const observedTime = state.currentTime;
    const observedProgressEpoch = this.progressEpoch;
    const observedReadyState = state.readyState;
    this.timer.scheduleWatchdog(NO_PROGRESS_WATCHDOG_MS, () => {
      const current = this.actions.getSnapshot();
      if (
        current.generation !== state.generation ||
        !current.shouldResume ||
        !current.input
      ) {
        return;
      }
      if (
        Number.isFinite(current.currentTime) &&
        current.currentTime >= observedTime + MIN_MEDIA_TIME_PROGRESS_SECONDS
      ) {
        this.playing();
        return;
      }
      if (
        (this.progressEpoch !== observedProgressEpoch ||
          current.readyState > observedReadyState) &&
        this.timer.stalledDuration() < MAX_FETCH_WITHOUT_MEDIA_PROGRESS_MS
      ) {
        if (current.paused) {
          this.actions.resume().catch(() => {
            // A later gesture or reconnect attempt can resume playback.
          });
        }
        this.watch(error);
        return;
      }
      this.scheduleReload(this.timer.error ?? error, state.generation);
    });
  }

  private async reload(generation: number): Promise<void> {
    const state = this.actions.getSnapshot();
    if (
      !state.input ||
      state.generation !== generation ||
      !state.shouldResume ||
      state.isOffline
    ) {
      return;
    }

    this.actions.setState("connecting", true);
    this._isReloading = true;
    try {
      await this.actions.reload(state.input, generation);
      const current = this.actions.getSnapshot();
      if (current.generation !== generation || !current.shouldResume) {
        return;
      }
      await this.actions.resume();
    } catch (error) {
      const current = this.actions.getSnapshot();
      if (current.generation !== generation || !current.shouldResume) {
        return;
      }
      this.scheduleReload(
        error instanceof Error ? error : new Error("Audio playback failed"),
        generation
      );
    } finally {
      if (this.actions.getSnapshot().generation === generation) {
        this._isReloading = false;
      }
    }
  }

  private scheduleReload(error: Error, generation: number): void {
    const state = this.actions.getSnapshot();
    if (
      state.generation !== generation ||
      !state.shouldResume ||
      !state.input
    ) {
      return;
    }

    this.timer.noteStall(error);
    if (state.isOffline || this.timer.hasTimer) {
      return;
    }
    this.timer.scheduleRetry(() => {
      this.reload(generation).catch((reloadError: unknown) => {
        this.failed(
          reloadError instanceof Error
            ? reloadError
            : new Error("Audio stream recovery failed")
        );
      });
    });
  }

  private terminal(error: Error, recoveryPending = false): void {
    this.timer.cancel();
    this.actions.onTerminalError(error, recoveryPending);
  }
}
