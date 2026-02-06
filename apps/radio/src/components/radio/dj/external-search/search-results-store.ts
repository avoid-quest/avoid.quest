import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { create } from "zustand";

type SearchResultsState = {
  results: UnifiedSearchResult[];
  error: string | null;
  setResults: (results: UnifiedSearchResult[]) => void;
  setError: (error: string) => void;
  clearResults: () => void;
};

export const useSearchResultsStore = create<SearchResultsState>((set) => ({
  results: [],
  error: null,
  setResults: (results) => set({ results, error: null }),
  setError: (error) => set({ error, results: [] }),
  clearResults: () => set({ results: [], error: null }),
}));
