import { useStore } from "@tanstack/react-store";
import { usePaginatedQuery } from "convex-helpers/react";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { Id } from "@avoid.quest/backend/convex/_generated/dataModel";
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
 * Uses convex-helpers pagination for infinite scroll
 */
export function useFilteredPosts(initialNumItems = 12) {
  const state = useStore(filterStore);
  const debouncedSearch = useDebouncedValue(state.search, 300);
  const isSearching = debouncedSearch.trim().length > 0;
  const hasFilters = state.userId !== null || state.datePreset !== "all";

  // Search results (when search is active) - not paginated
  const searchResults = useQuery(
    api.api.posts.search,
    isSearching ? { query: debouncedSearch, limit: 50 } : "skip"
  );

  // Filtered results (when filters active but not searching) - not paginated
  const filteredResults = useQuery(
    api.api.posts.getFiltered,
    !isSearching && hasFilters
      ? {
          limit: 100,
          userId: (state.userId as Id<"users">) ?? undefined,
          startDate: state.startDate ?? undefined,
          endDate: state.endDate ?? undefined,
        }
      : "skip"
  );

  // Default paginated results (no search, no filters)
  // Uses convex-helpers usePaginatedQuery for proper infinite scroll
  const paginatedResults = usePaginatedQuery(
    api.api.posts.getPaginated,
    isSearching || hasFilters ? "skip" : {},
    { initialNumItems }
  );

  // Return appropriate results based on mode
  if (isSearching) {
    return {
      results: searchResults ?? [],
      isLoading: searchResults === undefined,
      loadMore: () => {
        /* no-op: search not paginated */
      },
      status: searchResults === undefined ? "LoadingFirstPage" : "Exhausted",
      isSearchMode: true,
    };
  }

  if (hasFilters) {
    return {
      results: filteredResults ?? [],
      isLoading: filteredResults === undefined,
      loadMore: () => {
        /* no-op: filters not paginated */
      },
      status: filteredResults === undefined ? "LoadingFirstPage" : "Exhausted",
      isSearchMode: false,
    };
  }

  return {
    results: paginatedResults.results,
    isLoading: paginatedResults.status === "LoadingFirstPage",
    loadMore: paginatedResults.loadMore,
    status: paginatedResults.status,
    isSearchMode: false,
  };
}
