import type { PlaybackActionContext } from "./playback-action-context.js";

export function singleSelectionAbortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("Selection superseded", "AbortError")
  );
}

class SingleSelectionCoordinator {
  private active: AbortController | null = null;
  private tail: Promise<void> = Promise.resolve();

  run(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;

    const pending = this.tail.then(() => {
      if (controller.signal.aborted) {
        throw singleSelectionAbortReason(controller.signal);
      }
      return task(controller.signal);
    });
    this.tail = pending.then(
      () => undefined,
      () => undefined
    );

    return pending
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        throw error;
      })
      .finally(() => {
        if (this.active === controller) {
          this.active = null;
        }
      });
  }

  async cancelAndDrain(): Promise<void> {
    this.active?.abort();
    await this.tail;
  }
}

// Hooks and mode lifecycle code create short-lived workflow facades. One
// coordinator per shared action context keeps Single transactions serialized
// across every facade without coupling Multiple mode to that lifecycle.
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
