import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { radioGardenSearch } from "@/utils/radio-garden.functions";

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

export function useUnifiedRadioSearch(query: string, localRadios: Radio[]) {
  const [remoteResults, setRemoteResults] = useState<RadioGardenSearchResult[]>(
    []
  );

  const searchMutation = useMutation({
    mutationFn: async (q: string): Promise<RadioGardenSearchResult[]> => {
      const response = await radioGardenSearch({ data: { query: q } });
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      return response.data.results;
    },
    onSuccess: (results) => {
      setRemoteResults(results);
    },
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (q.length < 2) {
        setRemoteResults([]);
        return;
      }
      debounceRef.current = setTimeout(() => {
        searchMutation.mutate(q);
      }, 300);
    },
    [searchMutation.mutate]
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
      setRemoteResults([]);
    }
  }, [query]);

  const localResults = query.trim()
    ? filterLocalRadios(localRadios, query)
    : localRadios;

  return {
    localResults,
    remoteResults,
    isSearching: searchMutation.isPending,
  };
}
