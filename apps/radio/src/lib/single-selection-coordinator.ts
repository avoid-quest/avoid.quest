import PQueue from "p-queue";
import type { PlaybackActionContext } from "./playback-action-context.js";

export function singleSelectionAbortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("Selection superseded", "AbortError")
  );
}

class SingleSelectionCoordinator {
  private active: AbortController | null = null;
  private readonly queue = new PQueue({ concurrency: 1 });
  private deactivationCount = 0;

  run(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.deactivationCount > 0) {
      return Promise.resolve();
    }

    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;

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
