import { describe, expect, test } from "bun:test";
import type { PlaybackActionContext } from "./playback-action-context.js";
import { getSingleSelectionCoordinator } from "./single-selection-coordinator.js";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => undefined;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("SingleSelectionCoordinator", () => {
  test("shares latest-task cancellation across workflow facades", async () => {
    const context = {} as PlaybackActionContext;
    const firstFacade = getSingleSelectionCoordinator(context);
    const secondFacade = getSingleSelectionCoordinator(context);
    const firstStarted = createDeferred();
    let firstAborted = false;
    const first = firstFacade.run(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          firstStarted.resolve();
          signal.addEventListener(
            "abort",
            () => {
              firstAborted = true;
              reject(signal.reason);
            },
            { once: true }
          );
        })
    );
    await firstStarted.promise;

    const second = secondFacade.run(async () => undefined);

    await Promise.all([first, second]);
    expect(firstAborted).toBe(true);
  });

  test("does not hide an AbortError raised by the selected task", async () => {
    const coordinator = getSingleSelectionCoordinator(
      {} as PlaybackActionContext
    );
    const transportAbort = new DOMException("Transport aborted", "AbortError");

    await expect(
      coordinator.run(() => Promise.reject(transportAbort))
    ).rejects.toBe(transportAbort);
  });

  test("cancelAndDrain waits for abort cleanup to finish", async () => {
    const coordinator = getSingleSelectionCoordinator(
      {} as PlaybackActionContext
    );
    const cleanup = createDeferred();
    let cleanupFinished = false;
    const selection = coordinator.run(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cleanup.promise.then(() => {
                cleanupFinished = true;
                reject(signal.reason);
              });
            },
            { once: true }
          );
        })
    );
    await Promise.resolve();

    const drain = coordinator.cancelAndDrain();
    await Promise.resolve();
    expect(cleanupFinished).toBe(false);

    cleanup.resolve();
    await Promise.all([selection, drain]);
    expect(cleanupFinished).toBe(true);
  });
});
