import { usePaginatedQuery, useQuery } from "convex/react";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";
import { api } from "@/lib/convex";
import {
  filterStore,
  hasActiveFilters,
  type FilterState,
} from "@/lib/stores/filter-store";

/**
 * Hook to access filter state
 */
export function useFilterState() {
  return useStore(filterStore);
}

/**
 * Check if any filters are active
 */
export function useHasActiveFilters() {
  const state = useStore(filterStore);
  return hasActiveFilters(state);
}

/**
 * Debounced search value
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for filtered/searched posts
 * Uses search endpoint when search is active, filtered pagination otherwise
 */
export function useFilteredPosts(pageSize = 20) {
  const state = useStore(filterStore);
  const debouncedSearch = useDebouncedValue(state.search, 300);
  const isSearching = debouncedSearch.trim().length > 0;

  // Search results (when search is active)
  const searchResults = useQuery(
    api.api.posts.search,
    isSearching ? { query: debouncedSearch, limit: 50 } : "skip"
  );

  // Filtered paginated results (when not searching)
  const filteredResults = usePaginatedQuery(
    api.api.posts.getFiltered,
    !isSearching
      ? {
          userId: state.userId ?? undefined,
          startDate: state.startDate ?? undefined,
          endDate: state.endDate ?? undefined,
        }
      : "skip",
    { initialNumItems: pageSize }
  );

  // Return appropriate results based on mode
  if (isSearching) {
    return {
      results: searchResults ?? [],
      status: searchResults === undefined ? "LoadingFirstPage" : "CanLoadMore",
      loadMore: () => {},
      isSearchMode: true,
    };
  }

  return {
    results: filteredResults.results,
    status: filteredResults.status,
    loadMore: filteredResults.loadMore,
    isSearchMode: false,
  };
}
