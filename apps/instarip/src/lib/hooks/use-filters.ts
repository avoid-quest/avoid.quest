import { useStore } from "@tanstack/react-store";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/convex";
import { filterStore, hasActiveFilters } from "@/lib/stores/filter-store";

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
 * Uses search endpoint when search is active, filtered query otherwise
 *
 * NOTE: No pagination - Convex components don't support it.
 * All queries return up to `limit` results.
 */
export function useFilteredPosts(limit = 50) {
  const state = useStore(filterStore);
  const debouncedSearch = useDebouncedValue(state.search, 300);
  const isSearching = debouncedSearch.trim().length > 0;
  const hasFilters = state.userId !== null || state.datePreset !== "all";

  // Search results (when search is active)
  const searchResults = useQuery(
    api.api.posts.search,
    isSearching ? { query: debouncedSearch, limit } : "skip"
  );

  // Filtered results (when filters active but not searching)
  const filteredResults = useQuery(
    api.api.posts.getFiltered,
    !isSearching && hasFilters
      ? {
          limit,
          userId: state.userId ?? undefined,
          startDate: state.startDate ?? undefined,
          endDate: state.endDate ?? undefined,
        }
      : "skip"
  );

  // Default results (no search, no filters)
  const defaultResults = useQuery(
    api.api.posts.getPosts,
    isSearching || hasFilters ? "skip" : { limit }
  );

  // Return appropriate results based on mode
  if (isSearching) {
    return {
      results: searchResults ?? [],
      isLoading: searchResults === undefined,
      isSearchMode: true,
    };
  }

  if (hasFilters) {
    return {
      results: filteredResults ?? [],
      isLoading: filteredResults === undefined,
      isSearchMode: false,
    };
  }

  return {
    results: defaultResults ?? [],
    isLoading: defaultResults === undefined,
    isSearchMode: false,
  };
}
