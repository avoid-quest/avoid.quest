import { captureError } from "@avoid.quest/error";
import { createPacedMutations, type Transaction } from "@tanstack/react-db";
import { Throttler } from "@tanstack/react-pacer";
import {
  playbackSessionsCollection,
  updatePlaybackSession,
} from "./playback-sessions";

/** Keep live edits optimistic; write at most every 250 ms and flush on release. */
export function createNodeSessionPersistence(
  onError: (error: unknown) => void = (error) => {
    captureError(error, { operation: "persistNodeSession", surface: "ui" });
  }
) {
  const throttler = new Throttler((commit: () => unknown) => commit(), {
    leading: true,
    trailing: true,
    wait: 250,
  });
  const mutate = createPacedMutations<
    Parameters<typeof updatePlaybackSession>[1]
  >({
    mutationFn: ({ transaction }) => {
      playbackSessionsCollection.utils.acceptMutations(transaction);
      return Promise.resolve();
    },
    onMutate: (updater) => updatePlaybackSession("node", updater),
    strategy: {
      _type: "throttle",
      cleanup: () => throttler.cancel(),
      execute: (commit) => throttler.maybeExecute(commit),
      options: { leading: true, trailing: true, wait: 250 },
    },
  });
  let pending: Transaction | undefined;
  return {
    flush: () => throttler.flush(),
    update(updater: Parameters<typeof updatePlaybackSession>[1]) {
      const transaction = mutate(updater);
      if (pending !== transaction) {
        pending = transaction;
        transaction.isPersisted.promise.catch(onError);
      }
    },
    /** Waits for writes made while waiting too, e.g. a commit's. */
    async whenSettled() {
      let settled: Transaction | undefined;
      while (settled !== pending) {
        settled = pending;
        throttler.flush();
        // biome-ignore lint/performance/noAwaitInLoops: a write can follow while this one persists.
        await settled?.isPersisted.promise;
      }
    },
  };
}
