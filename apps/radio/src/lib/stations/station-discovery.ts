import type { Radio } from "@/lib/audio";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULT_LIMIT = 8;
const MAX_CONCURRENT_AUDIO_PROBES = 2;
const GENERIC_SEARCH_TERMS = new Set(["am", "fm", "radio", "station"]);
const TRAILING_SLASH_PATTERN = /\/$/;

export type StationDiscoverySource = "local" | "radio-browser" | "radio-garden";

export type StationDiscoveryCandidate = {
  country?: string;
  description?: string;
  key: string;
  location?: string;
  logoUrl?: string;
  radio: Radio;
  source: Exclude<StationDiscoverySource, "local">;
};

export type StationDiscoveryAction =
  | { radio: Radio; type: "local" }
  | { radio: Radio; type: "radio-browser" }
  | { radio: Radio; type: "radio-garden" };

export type StationDiscoveryResult = {
  action: StationDiscoveryAction;
  country?: string;
  description?: string;
  key: string;
  location?: string;
  logoUrl?: string;
  name: string;
  sources: StationDiscoverySource[];
};

export type StationDiscoverySnapshot = {
  duplicateCount: number;
  isSearching: boolean;
  results: StationDiscoveryResult[];
};

export type StationDirectoryAdapter = {
  search: (
    query: string,
    options: { limit: number; signal: AbortSignal }
  ) => Promise<StationDiscoveryCandidate[]>;
};

export type StationStreamProbeAdapter = {
  prepare: (
    candidate: StationDiscoveryCandidate,
    signal: AbortSignal
  ) => Promise<StationDiscoveryCandidate | null>;
};

export type StationDiscoveryAdapters = {
  radioBrowser: StationDirectoryAdapter;
  radioGarden: StationDirectoryAdapter;
  streamProbe: StationStreamProbeAdapter;
};

export type StationDiscoveryInput = {
  knownStations: readonly Radio[];
  playbackNeedsNetwork?: boolean;
  query: string;
};

export type StationDiscovery = {
  search: (
    input: StationDiscoveryInput,
    publish: (snapshot: StationDiscoverySnapshot) => void
  ) => () => void;
};

type NetworkInformationNavigator = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

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

const pendingAudioProbes: Array<() => void> = [];
let activeAudioProbeCount = 0;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Search aborted", "AbortError");
}

function stopWaitingOnAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function drainAudioProbeQueue(): void {
  const concurrency = preferredAudioProbeConcurrency();
  while (activeAudioProbeCount < concurrency && pendingAudioProbes.length > 0) {
    pendingAudioProbes.shift()?.();
  }
}

function scheduleAudioProbe<T>(
  probe: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let started = false;
    const abort = () => {
      if (!(settled || started)) {
        settled = true;
        reject(abortReason(signal));
      }
    };
    const start = () => {
      if (settled) {
        drainAudioProbeQueue();
        return;
      }
      started = true;
      signal.removeEventListener("abort", abort);
      activeAudioProbeCount += 1;
      let pending: Promise<T>;
      try {
        pending = probe();
      } catch (error) {
        pending = Promise.reject(error);
      }
      stopWaitingOnAbort(pending, signal).then(resolve, reject);
      const releasePhysicalSlot = () => {
        activeAudioProbeCount -= 1;
        drainAudioProbeQueue();
      };
      pending.then(releasePhysicalSlot, releasePhysicalSlot);
    };

    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    pendingAudioProbes.push(start);
    drainAudioProbeQueue();
  });
}

function toLocalResult(radio: Radio): StationDiscoveryResult {
  return {
    action: { radio, type: "local" },
    country: radio.countryTitle,
    description: radio.description,
    key: `local:${radio.id ?? radio.streamUrl}`,
    location: radio.placeTitle,
    logoUrl: radio.logoUrl,
    name: radio.name,
    sources: ["local"],
  };
}

function toRemoteResult(
  candidate: StationDiscoveryCandidate
): StationDiscoveryResult {
  return {
    action:
      candidate.source === "radio-browser"
        ? { radio: candidate.radio, type: "radio-browser" }
        : { radio: candidate.radio, type: "radio-garden" },
    country: candidate.country,
    description: candidate.description,
    key: candidate.key,
    location: candidate.location,
    logoUrl: candidate.logoUrl,
    name: candidate.radio.name,
    sources: [candidate.source],
  };
}

function normalizeSearchText(value: string | undefined): string {
  return (
    value
      ?.normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim() ?? ""
  );
}

function filterKnownStations(
  stations: readonly Radio[],
  query: string
): Radio[] {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  return stations.filter((station) => {
    const searchText = normalizeSearchText(
      [
        station.name,
        station.description,
        station.placeTitle,
        station.countryTitle,
      ]
        .filter(Boolean)
        .join(" ")
    );
    return terms.every((term) => searchText.includes(term));
  });
}

function hasSafeStreamUrl(candidate: StationDiscoveryCandidate): boolean {
  try {
    const url = new URL(candidate.radio.streamUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizedStreamUrl(result: StationDiscoveryResult): string {
  try {
    const url = new URL(result.action.radio.streamUrl);
    url.hash = "";
    return url.toString().replace(TRAILING_SLASH_PATTERN, "");
  } catch {
    return "";
  }
}

function hasMatchingCrossProviderIdentity(
  first: StationDiscoveryResult,
  second: StationDiscoveryResult
): boolean {
  if (
    first.action.type === "local" ||
    second.action.type === "local" ||
    first.action.type === second.action.type ||
    normalizeSearchText(first.name) !== normalizeSearchText(second.name)
  ) {
    return false;
  }
  const firstCountry = normalizeSearchText(first.country);
  const secondCountry = normalizeSearchText(second.country);
  if (!(firstCountry && firstCountry === secondCountry)) {
    return false;
  }
  const firstLocation = normalizeSearchText(first.location);
  return (
    !!firstLocation && firstLocation === normalizeSearchText(second.location)
  );
}

function mergeResults(
  candidates: StationDiscoveryResult[]
): StationDiscoveryResult[] {
  const merged: StationDiscoveryResult[] = [];
  for (const candidate of candidates) {
    const streamUrl = normalizedStreamUrl(candidate);
    const duplicate = merged.find((result) => {
      const resultUrl = normalizedStreamUrl(result);
      return (
        (!!streamUrl && streamUrl === resultUrl) ||
        hasMatchingCrossProviderIdentity(result, candidate)
      );
    });
    if (duplicate) {
      duplicate.sources = [
        ...new Set([...duplicate.sources, ...candidate.sources]),
      ];
    } else {
      merged.push({ ...candidate, sources: [...candidate.sources] });
    }
  }
  return merged;
}

function snapshot(
  results: StationDiscoveryResult[],
  isSearching: boolean,
  query: string
): StationDiscoverySnapshot {
  const mergedResults = mergeResults(results);
  const significantTerms = normalizeSearchText(query)
    .split(" ")
    .filter((term) => term && !GENERIC_SEARCH_TERMS.has(term));
  const relevantResults = mergedResults.filter((result) => {
    if (significantTerms.length === 0) {
      return true;
    }
    const searchText = normalizeSearchText(
      [result.name, result.location, result.country, result.description]
        .filter(Boolean)
        .join(" ")
    );
    return significantTerms.every((term) => searchText.includes(term));
  });
  return {
    duplicateCount: results.length - mergedResults.length,
    isSearching,
    results: relevantResults.slice(0, SEARCH_RESULT_LIMIT),
  };
}

export function createStationDiscovery(
  adapters: StationDiscoveryAdapters
): StationDiscovery {
  let generation = 0;
  let activeController: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  return {
    search(input, publish) {
      generation += 1;
      const requestGeneration = generation;
      activeController?.abort();
      if (debounce) {
        clearTimeout(debounce);
      }

      const query = input.query.trim();
      const localResults = filterKnownStations(input.knownStations, query).map(
        toLocalResult
      );
      if (query.length < 2 || input.playbackNeedsNetwork) {
        publish(snapshot(localResults, false, query));
        return () => undefined;
      }

      publish(snapshot(localResults, true, query));
      const controller = new AbortController();
      activeController = controller;
      debounce = setTimeout(() => {
        let pendingProviderCount = 2;
        let radioBrowserResults: StationDiscoveryResult[] = [];
        let radioGardenResults: StationDiscoveryResult[] = [];

        const loadProvider = async (
          adapter: StationDirectoryAdapter
        ): Promise<StationDiscoveryResult[]> => {
          let candidates: StationDiscoveryCandidate[];
          try {
            candidates = await adapter.search(query, {
              limit: 10,
              signal: controller.signal,
            });
          } catch {
            return [];
          }
          const probes: Promise<StationDiscoveryCandidate | null>[] = [];
          for (const candidate of candidates.filter(hasSafeStreamUrl)) {
            probes.push(
              scheduleAudioProbe(
                () =>
                  adapters.streamProbe.prepare(candidate, controller.signal),
                controller.signal
              ).catch(() => null)
            );
            await Promise.resolve();
          }
          const probed = await Promise.all(probes);
          return probed.flatMap((candidate) =>
            candidate ? [toRemoteResult(candidate)] : []
          );
        };

        const settleProvider = async (
          source: Exclude<StationDiscoverySource, "local">,
          adapter: StationDirectoryAdapter
        ) => {
          const results = await loadProvider(adapter);
          if (controller.signal.aborted || requestGeneration !== generation) {
            return;
          }
          if (source === "radio-browser") {
            radioBrowserResults = results;
          } else {
            radioGardenResults = results;
          }
          pendingProviderCount -= 1;
          publish(
            snapshot(
              [...localResults, ...radioBrowserResults, ...radioGardenResults],
              pendingProviderCount > 0,
              query
            )
          );
        };

        settleProvider("radio-browser", adapters.radioBrowser).catch(
          () => undefined
        );
        settleProvider("radio-garden", adapters.radioGarden).catch(
          () => undefined
        );
      }, SEARCH_DEBOUNCE_MS);

      return () => {
        if (requestGeneration !== generation) {
          return;
        }
        generation += 1;
        clearTimeout(debounce);
        controller.abort();
      };
    },
  };
}
