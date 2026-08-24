import PQueue from "p-queue";
import type { PlaybackActionContext } from "./playback-action-context.js";

export function singleSelectionAbortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("Selection superseded", "AbortError")
  );
}

export type SingleSelectionState = {
  playbackIntent: boolean;
  rollbackSoundId: string | null;
};

class SingleSelectionCoordinator {
  private active: AbortController | null = null;
  private activeSelection: SingleSelectionState | null = null;
  private readonly queue = new PQueue({ concurrency: 1 });
  private deactivationCount = 0;

  run(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    return this.enqueue(task, null);
  }

  runSelection(
    playbackIntent: boolean,
    rollbackSoundId: string | null,
    task: (signal: AbortSignal, state: SingleSelectionState) => Promise<void>
  ): Promise<void> {
    const state = this.activeSelection ?? { playbackIntent, rollbackSoundId };
    return this.enqueue((signal) => task(signal, state), state);
  }

  updatePlaybackIntent(playbackIntent: boolean): void {
    if (this.activeSelection) {
      this.activeSelection.playbackIntent = playbackIntent;
    }
  }

  async runAfterCurrent(task: () => Promise<void>): Promise<void> {
    if (this.deactivationCount > 0) {
      return;
    }
    await this.queue.add(async () => {
      if (this.deactivationCount === 0) {
        await task();
      }
    });
  }

  private enqueue(
    task: (signal: AbortSignal) => Promise<void>,
    selection: SingleSelectionState | null
  ): Promise<void> {
    if (this.deactivationCount > 0) {
      return Promise.resolve();
    }

    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    this.activeSelection = selection;

    return this.queue
      .add(() => task(controller.signal), { signal: controller.signal })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          throw error;
        }
      })
      .finally(() => {
        if (this.active === controller) {
          this.active = null;
          this.activeSelection = null;
        }
      });
  }

  async cancelAndRun(task: () => Promise<void>): Promise<void> {
    this.deactivationCount += 1;
    this.active?.abort();
    try {
      await this.queue.add(task);
    } finally {
      this.deactivationCount -= 1;
    }
  }
}

const coordinators = new WeakMap<
  PlaybackActionContext,
  SingleSelectionCoordinator
>();

export function getSingleSelectionCoordinator(
  ctx: PlaybackActionContext
): SingleSelectionCoordinator {
  const existing = coordinators.get(ctx);
  if (existing) {
    return existing;
  }

  const coordinator = new SingleSelectionCoordinator();
  coordinators.set(ctx, coordinator);
  return coordinator;
}
