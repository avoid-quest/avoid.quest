import {
  type RadioBrowserStation,
  searchRadioBrowser,
} from "@avoid.quest/platforms/radiobrowser";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  prepareRadioGardenSearchCandidate,
  type RadioGardenSearchCandidate,
  searchRadioGarden,
} from "@/lib/platform-client";
import { createGlobalAudioProbeScheduler } from "@/lib/stations/audio-probe-scheduler";
import {
  createRadioBrowserRadio,
  createRadioGardenRadio,
} from "@/lib/stations/external-station-workflow";
import {
  filterPlayableRadioBrowserStations,
  RADIO_BROWSER_RESULT_LIMIT,
} from "@/lib/stations/radio-browser-playability";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

const SEARCH_RESULT_LIMIT = 8;
const GENERIC_SEARCH_TERMS = new Set(["am", "fm", "radio", "station"]);
const TRAILING_SLASH_PATTERN = /\/$/;

export type UnifiedRadioSearchAction =
  | { radio: Radio; type: "local" }
  | { radio: Radio; type: "radio-browser" }
  | { radio: Radio; type: "radio-garden" };

export type UnifiedRadioSearchResult = {
  action: UnifiedRadioSearchAction;
  country?: string;
  description?: string;
  key: string;
  location?: string;
  logoUrl?: string;
  name: string;
  sources: UnifiedRadioSearchAction["type"][];
};

type UnifiedSearchInput = {
  localRadios: Radio[];
  query: string;
  radioBrowserResults: RadioBrowserStation[];
  radioGardenResults: Radio[];
};

export type UnifiedSearchOutput = {
  duplicateCount: number;
  results: UnifiedRadioSearchResult[];
};

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

function normalizeStreamUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    url.hash = "";
    return url.toString().replace(TRAILING_SLASH_PATTERN, "");
  } catch {
    return "";
  }
}

function normalizedLocation(
  location: string | undefined,
  country: string | undefined
): string | undefined {
  return normalizeSearchText(location) === normalizeSearchText(country)
    ? undefined
    : location || undefined;
}

function resultSearchText(result: UnifiedRadioSearchResult): string {
  return normalizeSearchText(
    [result.name, result.location, result.country, result.description]
      .filter(Boolean)
      .join(" ")
  );
}

function significantQueryTerms(query: string): string[] {
  return normalizeSearchText(query)
    .split(" ")
    .filter((term) => term && !GENERIC_SEARCH_TERMS.has(term));
}

function keepRelevantResults(
  results: UnifiedRadioSearchResult[],
  query: string
): UnifiedRadioSearchResult[] {
  const terms = significantQueryTerms(query);
  if (terms.length === 0) {
    return results;
  }
  return results.filter((result) => {
    const searchText = resultSearchText(result);
    return terms.every((term) => searchText.includes(term));
  });
}

function resultStreamUrl(result: UnifiedRadioSearchResult): string {
  return normalizeStreamUrl(result.action.radio.streamUrl);
}

function hasMatchingCrossProviderIdentity(
  first: UnifiedRadioSearchResult,
  second: UnifiedRadioSearchResult
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
  if (!(firstCountry && secondCountry && firstCountry === secondCountry)) {
    return false;
  }
  const firstLocation = normalizeSearchText(first.location);
  const secondLocation = normalizeSearchText(second.location);
  return !!firstLocation && firstLocation === secondLocation;
}

function isDuplicateResult(
  first: UnifiedRadioSearchResult,
  second: UnifiedRadioSearchResult
): boolean {
  const firstStream = resultStreamUrl(first);
  const secondStream = resultStreamUrl(second);
  if (firstStream && firstStream === secondStream) {
    return true;
  }
  return hasMatchingCrossProviderIdentity(first, second);
}

function toLocalResult(radio: Radio): UnifiedRadioSearchResult {
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

function toRadioBrowserResult(
  station: RadioBrowserStation
): UnifiedRadioSearchResult {
  const radio = createRadioBrowserRadio(station);
  return {
    action: { radio, type: "radio-browser" },
    country: station.country || undefined,
    description: station.tags.slice(0, 3).join(", ") || undefined,
    key: `radio-browser:${station.stationUuid}`,
    location: normalizedLocation(station.state, station.country),
    logoUrl: station.favicon || undefined,
    name: station.name,
    sources: ["radio-browser"],
  };
}

function toRadioGardenResult(radio: Radio): UnifiedRadioSearchResult {
  return {
    action: { radio, type: "radio-garden" },
    country: radio.countryTitle,
    description: radio.description,
    key: `radio-garden:${radio.id ?? radio.streamUrl}`,
    location: radio.placeTitle,
    logoUrl: radio.logoUrl,
    name: radio.name,
    sources: ["radio-garden"],
  };
}

export function mergeUnifiedRadioResults({
  localRadios,
  query,
  radioBrowserResults,
  radioGardenResults,
}: UnifiedSearchInput): UnifiedSearchOutput {
  const candidates = [
    ...localRadios.map(toLocalResult),
    ...radioBrowserResults.map(toRadioBrowserResult),
    ...radioGardenResults.map(toRadioGardenResult),
  ];
  const merged: UnifiedRadioSearchResult[] = [];

  for (const candidate of candidates) {
    const duplicate = merged.find((result) =>
      isDuplicateResult(result, candidate)
    );
    if (duplicate) {
      duplicate.sources = [
        ...new Set([...duplicate.sources, ...candidate.sources]),
      ];
    } else {
      merged.push(candidate);
    }
  }

  return {
    duplicateCount: candidates.length - merged.length,
    results: keepRelevantResults(merged, query).slice(0, SEARCH_RESULT_LIMIT),
  };
}

function filterLocalRadios(radios: Radio[], query: string): Radio[] {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) {
    return radios;
  }
  return radios.filter((radio) => {
    const searchText = normalizeSearchText(
      [radio.name, radio.description, radio.placeTitle, radio.countryTitle]
        .filter(Boolean)
        .join(" ")
    );
    return terms.every((term) => searchText.includes(term));
  });
}

function stopWaitingOnAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Search aborted", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(new DOMException("Search aborted", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", handleAbort);

    signal.addEventListener("abort", handleAbort, { once: true });
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

type RemoteSearchRequest = {
  query: string;
  requestId: number;
  signal: AbortSignal;
};

async function loadPlayableRadioGardenResults(
  candidates: RadioGardenSearchCandidate[],
  signal: AbortSignal
): Promise<Radio[]> {
  const scheduleProbe = createGlobalAudioProbeScheduler(signal);
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const prepared = await scheduleProbe(() =>
          prepareRadioGardenSearchCandidate(candidate, signal)
        );
        return createRadioGardenRadio(
          candidate,
          prepared.streamUrl,
          candidate.title,
          prepared.format
        );
      } catch {
        signal.throwIfAborted();
        return null;
      }
    })
  );
  return results.filter((radio): radio is Radio => radio !== null);
}

export function useUnifiedRadioSearch(query: string, localRadios: Radio[]) {
  const playbackNeedsNetwork = useStore(playbackRuntimeStore, (state) =>
    Object.values(state.channels).some(
      (channel) => channel.isLoading || channel.isBuffering
    )
  );
  const [radioGardenResults, setRadioGardenResults] = useState<Radio[]>([]);
  const [radioBrowserResults, setRadioBrowserResults] = useState<
    RadioBrowserStation[]
  >([]);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const radioGardenSearchMutation = useMutation({
    mutationFn: async ({ query: searchQuery, signal }: RemoteSearchRequest) => {
      const candidates = await stopWaitingOnAbort(
        searchRadioGarden(searchQuery),
        signal
      );
      return loadPlayableRadioGardenResults(candidates, signal);
    },
    onSuccess: (results, request) => {
      if (request.requestId === requestIdRef.current) {
        setRadioGardenResults(results);
      }
    },
    onError: (_error, request) => {
      if (request.requestId === requestIdRef.current) {
        setRadioGardenResults([]);
      }
    },
  });

  const radioBrowserSearchMutation = useMutation({
    mutationFn: async ({ query: searchQuery, signal }: RemoteSearchRequest) => {
      const stations = await searchRadioBrowser(searchQuery, {
        limit: RADIO_BROWSER_RESULT_LIMIT,
        signal,
      });
      return filterPlayableRadioBrowserStations(stations, {
        signal,
      });
    },
    onSuccess: (results, request) => {
      if (request.requestId === requestIdRef.current) {
        setRadioBrowserResults(results);
      }
    },
    onError: (_error, request) => {
      if (request.requestId === requestIdRef.current) {
        setRadioBrowserResults([]);
      }
    },
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const debouncedSearch = useCallback(
    (value: string) => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      const normalizedQuery = value.trim();
      if (normalizedQuery.length < 2) {
        setRadioBrowserResults([]);
        setRadioGardenResults([]);
        return;
      }
      // Do not let directory health probes compete with initial buffering or
      // recovery. The effect runs again and resumes discovery once healthy.
      if (playbackNeedsNetwork) {
        return;
      }
      setRadioBrowserResults([]);
      setRadioGardenResults([]);
      const requestId = requestIdRef.current;
      debounceRef.current = setTimeout(() => {
        const controller = new AbortController();
        abortRef.current = controller;
        const request = {
          query: normalizedQuery,
          requestId,
          signal: controller.signal,
        };
        radioBrowserSearchMutation.mutate(request);
        radioGardenSearchMutation.mutate(request);
      }, 300);
    },
    [
      playbackNeedsNetwork,
      radioBrowserSearchMutation.mutate,
      radioGardenSearchMutation.mutate,
    ]
  );

  useEffect(() => {
    debouncedSearch(query);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, debouncedSearch]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const localResults = filterLocalRadios(localRadios, query);
  const unified = mergeUnifiedRadioResults({
    localRadios: localResults,
    query,
    radioBrowserResults,
    radioGardenResults,
  });

  return {
    ...unified,
    isSearching:
      !playbackNeedsNetwork &&
      (radioBrowserSearchMutation.isPending ||
        radioGardenSearchMutation.isPending),
  };
}
