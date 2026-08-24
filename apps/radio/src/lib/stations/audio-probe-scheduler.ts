import PQueue from "p-queue";

type AudioProbeScheduler = <T>(probe: () => Promise<T>) => Promise<T>;

type NetworkInformationNavigator = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

const MAX_CONCURRENT_AUDIO_PROBES = 2;

function preferredAudioProbeConcurrency(): number {
  if (typeof navigator === "undefined") {
    return MAX_CONCURRENT_AUDIO_PROBES;
  }

  const connection = (navigator as NetworkInformationNavigator).connection;
  return connection?.saveData === true ||
    connection?.effectiveType?.endsWith("2g") === true
    ? 1
    : MAX_CONCURRENT_AUDIO_PROBES;
}

const globalAudioProbeQueue = new PQueue({
  concurrency: preferredAudioProbeConcurrency(),
});

export function createGlobalAudioProbeScheduler(
  signal?: AbortSignal
): AudioProbeScheduler {
  return <T>(probe: () => Promise<T>) => {
    globalAudioProbeQueue.concurrency = preferredAudioProbeConcurrency();
    return globalAudioProbeQueue.add(probe, { signal });
  };
}
