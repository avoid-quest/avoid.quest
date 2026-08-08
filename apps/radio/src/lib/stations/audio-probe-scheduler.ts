export const MAX_CONCURRENT_AUDIO_PROBES = 2;

export type AudioProbeScheduler = <T>(probe: () => Promise<T>) => Promise<T>;

type QueuedProbe<T> = {
  abort: () => void;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
  run: () => Promise<T>;
  signal?: AbortSignal;
  state: "active" | "done" | "queued";
};

export type AudioProbePool = {
  forSignal: (signal?: AbortSignal) => AudioProbeScheduler;
};

type NetworkInformationNavigator = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Search aborted", "AbortError");
}

export function preferredAudioProbeConcurrency(): number {
  if (typeof navigator === "undefined") {
    return MAX_CONCURRENT_AUDIO_PROBES;
  }
  const connection = (navigator as NetworkInformationNavigator).connection;
  return connection?.saveData === true ||
    connection?.effectiveType?.endsWith("2g") === true
    ? 1
    : MAX_CONCURRENT_AUDIO_PROBES;
}

export function createAudioProbePool(
  concurrency: () => number = preferredAudioProbeConcurrency
): AudioProbePool {
  const queue: QueuedProbe<unknown>[] = [];
  let activeCount = 0;

  const pump = () => {
    const limit = Math.max(1, Math.trunc(concurrency()));
    while (activeCount < limit && queue.length > 0) {
      const task = queue.shift();
      if (task?.state !== "queued") {
        continue;
      }
      if (task.signal?.aborted) {
        task.abort();
        continue;
      }

      task.state = "active";
      activeCount += 1;
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          activeCount -= 1;
          task.state = "done";
          task.signal?.removeEventListener("abort", task.abort);
          pump();
        });
    }
  };

  const schedule = <T>(
    run: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const task: QueuedProbe<T> = {
        abort: () => {
          if (settled) {
            return;
          }
          settled = true;
          if (task.state === "queued") {
            const index = queue.indexOf(task as QueuedProbe<unknown>);
            if (index >= 0) {
              queue.splice(index, 1);
            }
            task.state = "done";
            signal?.removeEventListener("abort", task.abort);
            pump();
          }
          reject(signal ? abortReason(signal) : undefined);
        },
        reject: (reason) => {
          if (!settled) {
            settled = true;
            reject(reason);
          }
        },
        resolve: (value) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        },
        run,
        signal,
        state: "queued",
      };
      signal?.addEventListener("abort", task.abort, { once: true });
      queue.push(task as QueuedProbe<unknown>);
      pump();
    });
  };

  return {
    forSignal: (signal) => (probe) => schedule(probe, signal),
  };
}

const globalAudioProbePool = createAudioProbePool();

export function createGlobalAudioProbeScheduler(
  signal?: AbortSignal
): AudioProbeScheduler {
  return globalAudioProbePool.forSignal(signal);
}

export function createAudioProbeScheduler(
  maxConcurrency = MAX_CONCURRENT_AUDIO_PROBES,
  signal?: AbortSignal
): AudioProbeScheduler {
  return createAudioProbePool(() => maxConcurrency).forSignal(signal);
}
