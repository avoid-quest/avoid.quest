import { captureError } from "@avoid.quest/error";
import { toast } from "@avoid.quest/ui/components/sonner";
import { createPacedMutations, type Transaction } from "@tanstack/react-db";
import { Throttler } from "@tanstack/react-pacer";
import {
  type PlaybackSessionId,
  playbackSessionsCollection,
  updatePlaybackSession,
} from "./playback-sessions";

/** Keep live edits optimistic; write at most every 250 ms and flush on release. */
export function createPlaybackSessionPersistence(
  sessionId: PlaybackSessionId,
  onError: (error: unknown) => void = (error) => {
    captureError(error, { operation: "persistPlaybackSession", surface: "ui" });
  }
) {
  const throttler = new Throttler((commit: () => unknown) => commit(), {
    leading: true,
    trailing: true,
    wait: 250,
  });
  type Edit = {
    updater: Parameters<typeof updatePlaybackSession>[1];
    apply?: () => void;
  };
  const recoveries = new Map<Transaction, Set<() => void>>();
  const mutate = createPacedMutations<Edit>({
    mutationFn: ({ transaction }) => {
      playbackSessionsCollection.utils.acceptMutations(transaction);
      return Promise.resolve();
    },
    onMutate: ({ updater, apply }) => {
      updatePlaybackSession(sessionId, updater, true);
      // Audio sees the optimistic value before even the leading storage write.
      apply?.();
    },
    strategy: {
      _type: "throttle",
      cleanup: () => throttler.cancel(),
      execute: (commit) => throttler.maybeExecute(commit),
      options: { leading: true, trailing: true, wait: 250 },
    },
  });
  let pending: Transaction | undefined;
  const writer = {
    flush: () => throttler.flush(),
    update(
      updater: Parameters<typeof updatePlaybackSession>[1],
      apply?: () => void
    ) {
      writers.add(writer);
      const transaction = mutate({ apply, updater });
      const callbacks = recoveries.get(transaction) ?? new Set<() => void>();
      recoveries.set(transaction, callbacks);
      if (apply) {
        callbacks.add(apply);
      }
      if (pending !== transaction) {
        pending = transaction;
        transaction.isPersisted.promise.then(
          () => {
            recoveries.delete(transaction);
            if (pending === transaction) {
              writers.delete(writer);
            }
          },
          (error: unknown) => {
            // The transaction has rolled back before this promise rejects.
            for (const recover of recoveries.get(transaction) ?? []) {
              recover();
            }
            recoveries.delete(transaction);
            if (pending === transaction) {
              writers.delete(writer);
            }
            onError(error);
            toast.error("Your mix settings could not be saved.");
          }
        );
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
  installFlushListeners();
  return writer;
}

type SessionWriter = ReturnType<typeof createPlaybackSessionPersistence>;
const writers = new Set<{ flush: () => unknown }>();
const sessionWriters = new Map<PlaybackSessionId, SessionWriter>();
let listeningWindow: Window | undefined;

export function flushPlaybackSessionWrites(): void {
  for (const writer of writers) {
    writer.flush();
  }
}

function installFlushListeners(): void {
  if (typeof window === "undefined" || listeningWindow === window) {
    return;
  }
  listeningWindow = window;
  window.addEventListener("pagehide", flushPlaybackSessionWrites);
  window.document.addEventListener("visibilitychange", () => {
    if (window.document.visibilityState === "hidden") {
      flushPlaybackSessionWrites();
    }
  });
  // Wheel and MIDI have no release signal and use the trailing write.
  window.addEventListener("pointerup", flushPlaybackSessionWrites);
  window.addEventListener("pointercancel", flushPlaybackSessionWrites);
  window.addEventListener("keyup", flushPlaybackSessionWrites);
}

export function getPlaybackSessionPersistence(sessionId: PlaybackSessionId) {
  let writer = sessionWriters.get(sessionId);
  if (!writer) {
    writer = createPlaybackSessionPersistence(sessionId);
    sessionWriters.set(sessionId, writer);
  }
  return writer;
}

export function createNodeSessionPersistence(
  onError?: (error: unknown) => void
) {
  return createPlaybackSessionPersistence("node", onError);
}
