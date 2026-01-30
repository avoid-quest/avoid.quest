import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useInView } from "react-intersection-observer";
import { Filters } from "@/components/feed/filters";
import { PostGrid, PostGridSkeleton } from "@/components/feed/post-grid";
import { useFilteredPosts, useHasActiveFilters } from "@/lib/hooks/use-filters";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const BATCH_SIZE = 20;

function HomePage() {
  const { results, isLoading, loadMore, status, isSearchMode } =
    useFilteredPosts(BATCH_SIZE);
  const hasFilters = useHasActiveFilters();
  const canLoadMore = status === "CanLoadMore";
  const isLoadingMore = status === "LoadingMore";

  // Auto-load when scrolling to bottom
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    rootMargin: "400px", // Start loading 400px before reaching the element
  });

  useEffect(() => {
    if (inView && canLoadMore && !isLoadingMore) {
      loadMore(BATCH_SIZE);
    }
  }, [inView, canLoadMore, isLoadingMore, loadMore]);

  return (
    <div className="container py-6">
      <h1 className="mb-4 font-bold text-2xl">
        {hasFilters ? "Search Results" : "Recent Posts"}
      </h1>

      {/* Filters */}
      <div className="mb-6">
        <Filters />
      </div>

      {/* Results count */}
      {hasFilters && !isLoading && (
        <p className="mb-4 text-muted-foreground text-sm">
          {results.length} {results.length === 1 ? "post" : "posts"} found
          {isSearchMode && " (search results)"}
        </p>
      )}

      {/* Post grid */}
      <PostGrid isLoading={isLoading} posts={results} />

      {/* Infinite scroll trigger with skeleton preview */}
      {canLoadMore && (
        <div className="mt-4" ref={loadMoreRef}>
          <PostGridSkeleton count={BATCH_SIZE} />
        </div>
      )}

      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="mt-4">
          <PostGridSkeleton count={BATCH_SIZE} />
        </div>
      )}
    </div>
  );
}
