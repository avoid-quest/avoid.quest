import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import {
  type RadioBrowserStation,
  searchRadioBrowser,
} from "@avoid.quest/platforms/radiobrowser";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { searchRadioGarden } from "@/lib/platform-client";
import {
  filterPlayableRadioBrowserStations,
  RADIO_BROWSER_RESULT_LIMIT,
} from "@/lib/stations/radio-browser-playability";

function filterLocalRadios(radios: Radio[], query: string): Radio[] {
  const q = query.toLowerCase();
  return radios.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      r.placeTitle?.toLowerCase().includes(q) ||
      r.countryTitle?.toLowerCase().includes(q)
  );
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

export function useUnifiedRadioSearch(query: string, localRadios: Radio[]) {
  const [radioGardenResults, setRadioGardenResults] = useState<
    RadioGardenSearchResult[]
  >([]);
  const [radioBrowserResults, setRadioBrowserResults] = useState<
    RadioBrowserStation[]
  >([]);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const radioGardenSearchMutation = useMutation({
    mutationFn: ({ query: searchQuery, signal }: RemoteSearchRequest) => {
      const request = searchRadioGarden(searchQuery);
      return stopWaitingOnAbort(request, signal);
    },
    onSuccess: (results, request) => {
      if (request.requestId !== requestIdRef.current) {
        return;
      }
      setRadioGardenResults(results);
    },
    onError: (_error, request) => {
      if (request.requestId !== requestIdRef.current) {
        return;
      }
      setRadioGardenResults([]);
    },
  });

  const radioBrowserSearchMutation = useMutation({
    mutationFn: async ({ query: searchQuery, signal }: RemoteSearchRequest) => {
      const stations = await searchRadioBrowser(searchQuery, {
        limit: RADIO_BROWSER_RESULT_LIMIT,
        signal,
      });
      return filterPlayableRadioBrowserStations(stations, { signal });
    },
    onSuccess: (results, request) => {
      if (request.requestId !== requestIdRef.current) {
        return;
      }
      setRadioBrowserResults(results);
    },
    onError: (_error, request) => {
      if (request.requestId !== requestIdRef.current) {
        return;
      }
      setRadioBrowserResults([]);
    },
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedSearch = useCallback(
    (q: string) => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      const normalizedQuery = q.trim();
      if (normalizedQuery.length < 2) {
        setRadioBrowserResults([]);
        setRadioGardenResults([]);
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
    [radioBrowserSearchMutation.mutate, radioGardenSearchMutation.mutate]
  );

  useEffect(() => {
    debouncedSearch(query);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, debouncedSearch]);

  useEffect(() => {
    if (!query.trim()) {
      setRadioBrowserResults([]);
      setRadioGardenResults([]);
    }
  }, [query]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const localResults = query.trim()
    ? filterLocalRadios(localRadios, query)
    : localRadios;

  return {
    localResults,
    radioBrowserResults,
    radioGardenResults,
    isSearching:
      radioBrowserSearchMutation.isPending ||
      radioGardenSearchMutation.isPending,
  };
}
